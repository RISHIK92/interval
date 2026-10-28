# 0023. OCR in AWS mode: a sidecar in the worker's task

- Status: ACCEPTED (owner, 2026-10-28)
- Date: 2026-10-28
- Supersedes: none (amends ADR-0022's AWS mode)
- Superseded by: none

## Context

ADR-0022 (accepted) runs scanned book pages through a Tesseract container, and says that in AWS mode it "runs as a small Fargate service". Building P2-W11-S03 showed that the worker's `ocr_page` stage is the service's only caller. A separate Fargate service would need its own service discovery (Cloud Map), a security group rule, and a task to keep running, all for one caller.

## Options

### A. A sidecar container in the worker's task (owner's choice)

**What it is:**
- The `ocr` container (deploy/ocr) runs in the always-on worker task, capped at 512 MiB.
- The worker reaches it at `http://localhost:8080`, since the task's containers share a network.
- It is non-essential: if it crashes, the consumer keeps serving every other stage, and scanned pages wait, retried, as on the VM.

- **Pros:**
  - No service discovery, load balancer or extra service.
  - The same shape as the VM, where the worker reaches `ocr` on the compose network.
  - OCR scales with the worker.
- **Cons:**
  - The worker task's memory rises to 2 GB.
  - OCR can't scale apart from the worker; it has no need to while the worker is its only caller.
- **Cost to reverse:** low: move the container to its own task definition and service, and point `OCR_URL` at its discovery name.

### B. Its own Fargate service, as ADR-0022 says

- **Pros:** OCR scales on its own.
- **Cons:** service discovery, a security group rule and another always-on task, for one caller.
- **Cost to reverse:** low.

## Recommendation (not a decision)

A: it keeps the AWS mode the same shape as the VM, with the least infrastructure, while the worker is OCR's only caller. Revisit if anything else ever calls OCR.

## Consequences

- `infra/src/aws-stack.ts`: an `ocr` container in the worker task definition, non-essential, 512 MiB; the task has 2048 MiB; the worker's `OCR_URL` is `http://localhost:8080`.
- ADR-0022's "a Fargate service in the AWS stack" is read as this sidecar.

## Open questions

- none
