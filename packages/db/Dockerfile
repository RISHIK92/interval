# Build from the repo root: the one-off migration task image for the AWS mode
# (ADR-0011, ADR-0002). The task definition supplies the entrypoint.
FROM ghcr.io/amacneil/dbmate:2.37.0
COPY packages/db/migrations /migrations
# Amazon RDS CA bundle (pinned digest) for verify-full TLS in the AWS mode (ADR-0011).
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /certs/rds-global-bundle.pem
# ADD's --chmod also applies to the directory it creates; make it traversable.
RUN chmod 755 /certs
