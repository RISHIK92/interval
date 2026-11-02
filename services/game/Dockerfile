# The game server (ADR-0033): a static binary on distroless, no shell. Built natively
# and cross-compiled for the target (ARM64 on Fargate), not under emulation.
FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /game .

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /game /game
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD ["/game", "healthcheck"]
ENTRYPOINT ["/game"]
