FROM caddy:builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/vercel@90ab6e6ed7835757bc5caf78168456c461d54b74 \
    --with github.com/lucaslorentz/caddy-docker-proxy/v2

FROM caddy:latest

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

CMD ["caddy", "docker-proxy"]
