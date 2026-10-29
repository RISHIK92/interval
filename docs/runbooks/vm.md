# Runbook: VM deployment mode (ADR-0011)

One EC2 VM (CDK stack `interval-prod`, infra/src/prod-stack.ts) runs everything from
`deploy/compose.prod.yml`: Postgres+pgvector, Valkey (queues, ADR-0014), the web app, Caddy, and
optional SeaweedFS. Per ADR-0013 nothing is deployed until every phase is built; this
runbook is for that deploy and after. The owner runs every step; Claude never deploys.

Everything that must survive replacing the VM lives on the retained data volume mounted
at `/var/lib/interval/pgdata`: Postgres data (`data/`), Valkey's queue data (`valkey/`, AOF every second, ADR-0014), VM-local files (`files/`) and
settings (`etc/`). The root disk holds only the code checkout and Docker state.

Never paste the output of `docker inspect` or `docker compose config`: both print secrets.

## Prerequisites
- AWS credentials for the prod account, region ap-south-1.
- The Session Manager plugin for the AWS CLI (shell access; there is no SSH).

## First deploy
1. `pnpm --filter @interval/infra exec cdk bootstrap` (once per account and region).
2. `pnpm --filter @interval/infra exec cdk deploy interval-prod`. Note the outputs: InstanceId, PublicIp, bucket names, secret ARNs.
3. Replace the placeholders with real keys (letters, digits, `_` and `-` only; anything else is refused at deploy):
   `aws secretsmanager put-secret-value --secret-id interval/prod/openrouter --secret-string '<key>'`
   and the same for `interval/prod/voyage`, and the GitHub App's (ADR-0024; its callback URL `https://<domain>/api/github/callback`): `interval/prod/github-app-slug`, `interval/prod/github-app-client-id`, `interval/prod/github-app-client-secret`, `interval/prod/github-app-id`, and `interval/prod/github-app-private-key` (base64 of the `.pem`: `base64 -i key.pem | tr -d '\n'`; its `+ / =` are allowed for this secret only). On the VM every service reads `app.env`, so the worker and migrations also see the GitHub client secret (as they do the OpenRouter and Voyage keys); AWS mode gives it to the web task only.
   Never change `interval/prod/postgres`: Postgres sets its password only when the data directory is first created, so a new value would lock the app out.
4. Open a shell: `aws ssm start-session --target <InstanceId>`, then `sudo -i`.
5. `git clone https://github.com/RISHIK92/interval.git /opt/interval`
6. `/opt/interval/deploy/bin/deploy.sh main`. It checks that the data volume is mounted, writes the env files to `/run/interval`, builds the images, runs migrations, starts everything, waits for health, and installs the systemd unit.
7. Check: `curl http://<PublicIp>/api/health` returns `{"status":"ok"}`.

If the Next.js build is killed for lack of memory on the 4 GB VM, add swap once:
`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`.

## Update
`/opt/interval/deploy/bin/deploy.sh <branch|tag|sha>`. A branch name deploys the remote branch's latest commit. Migrations run before the new web container starts (ADR-0002: each migration stays compatible with the previous release). Only one deploy runs at a time.

## If the site stops answering
Docker restarts containers that exit, but not ones that are merely unhealthy. Check `docker compose -f /opt/interval/deploy/compose.prod.yml ps`; an `unhealthy` web container needs `docker compose -f /opt/interval/deploy/compose.prod.yml restart web`.

## Run a job
`docker compose -f /opt/interval/deploy/compose.prod.yml run --rm jobs ingest-one --name ... --feed-url ... --rights-profile ...`

## Turn on concept tagging (P1-W3-S02)
Tagging is off until the tagging eval has picked a model (ADR-0010). Run `eval-tagging` against owner-labelled moments first. Then add `TAGGING_MODEL=<openrouter model id>` to the app env written by `deploy/bin/write-env.sh` and redeploy; the worker logs "TAGGING_MODEL: off (not set)" until it is set. Polls then queue tagging for every untagged item, within the AI budgets (OPS-4).

Embeddings (P1-W3-S04) work the same way: run `eval-embeddings` against owner-written queries, then set `EMBEDDING_MODEL=<voyage model id>` (and `VOYAGE_API_KEY`); until then the worker logs "EMBEDDING_MODEL: off (not set)".

## Set the domain (HTTPS)
The VM's domain is `interval.rishiklabs.tech` (owner, 2026-10-25). Set it before first use: sign-in calls from the browser are refused from any origin other than `BETTER_AUTH_URL`, which comes from this file.

1. Point a DNS A record at the Elastic IP and wait until it resolves.
2. `echo interval.rishiklabs.tech > /var/lib/interval/pgdata/etc/site-address`
3. `systemctl restart interval`. Caddy requests a Let's Encrypt certificate at startup.
4. Check: `curl https://interval.rishiklabs.tech/api/health`. The bare IP no longer matches the site.

## Keep files on the VM instead of S3
`echo local-s3 > /var/lib/interval/pgdata/etc/files-backend`, then run deploy.sh again. With files in S3 (the default), write the stack's `PrivateContentBucket` output once: `echo <PrivateContentBucket> > /var/lib/interval/pgdata/etc/private-content-bucket` (write-env.sh refuses to run without it, P2-W11-S01). On the VM, `stack.sh up` creates SeaweedFS's `interval-private` bucket. SeaweedFS starts with its data in `/var/lib/interval/pgdata/files`, and apps get `S3_ENDPOINT=http://seaweedfs:8333`. Remove the file and deploy again to go back to S3 (SeaweedFS is stopped). These files are **not** in the database backup below; back them up separately.

## Backup (manual, owner choice)
```
cd /opt/interval
dump="/tmp/interval-$(date +%F-%H%M).dump"
docker compose -f deploy/compose.prod.yml exec -T postgres pg_dump -U interval -Fc interval > "$dump"
aws s3 cp "$dump" "s3://<PrivateContentBucket>/backups/" && rm "$dump"
```
If files are kept on the VM, also copy them:
`tar -C /var/lib/interval/pgdata -czf /tmp/files.tgz files && aws s3 cp /tmp/files.tgz s3://<PrivateContentBucket>/backups/files-$(date +%F-%H%M).tgz && rm /tmp/files.tgz`.
The VM can put objects but not delete them; old object versions expire after 30 days.

## Restore
```
aws s3 cp s3://<PrivateContentBucket>/backups/<file>.dump /tmp/restore.dump
docker compose -f /opt/interval/deploy/compose.prod.yml stop web
docker compose -f /opt/interval/deploy/compose.prod.yml exec -T postgres pg_restore -U interval -d interval --clean --if-exists < /tmp/restore.dump
docker compose -f /opt/interval/deploy/compose.prod.yml start web
```

## Replace the VM (OS update, instance change)
The data volume is retained, but CloudFormation cannot attach it to a new instance while the old one holds it.
1. Back up (above).
2. `aws ec2 stop-instances --instance-ids <InstanceId>`, then `aws ec2 detach-volume --volume-id <PgData volume>`.
3. Change `AMI_ID` (or the instance type) in infra/src/prod-stack.ts and deploy the stack. The deploy waits for the VM's setup script to signal success.
4. On the new VM, repeat steps 4–6 of the first deploy (session, clone, deploy.sh). Data, VM-local files and settings come back from the volume.
