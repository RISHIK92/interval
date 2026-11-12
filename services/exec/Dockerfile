# The execution engine (ADR-0039 PROPOSED, EXEC-5): the Go service and a static docker
# CLI, which it drives on its own host. Built natively and cross-compiled for the target
# (ARM64 on the execution hosts), as the game server is.
FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY engine ./engine
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /exec .

# The docker CLI's own image (Alpine, static CLI), built 2026-10-21. The service runs as
# root with the host's Docker socket (W31), which is the host's root: a flaw in how it
# handles a job is a host compromise, so its own input handling is inside the red-team's
# scope. Runs can't reach the host or its role (--network none; IMDSv2, hop limit 1).
FROM docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb
COPY --from=build /exec /usr/local/bin/exec
ENTRYPOINT ["/usr/local/bin/exec"]
