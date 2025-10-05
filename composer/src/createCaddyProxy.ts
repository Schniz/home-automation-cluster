export function createCaddyProxy({ rootDomain }: { rootDomain: string }) {
  let index = 0;

  function usingUpstreams(
    subdomain: string,
    port: number,
    opts?: Record<string, string>
  ): Record<string, string> {
    return {
      ...root(),
      ...subdomainDefinition(subdomain, {
        ...opts,
        reverse_proxy: `{{upstreams ${port}}}`,
      }),
    };
  }

  function root() {
    return {
      caddy_0: `*.${rootDomain}`,
      "caddy_0.tls.dns": "cloudflare {env.CF_API_TOKEN}",
    };
  }

  function subdomainDefinition(
    subdomain: string,
    options: Record<string, string>
  ): Record<string, string> {
    const current = ++index;
    const name = subdomain.replace(/[^A-z0-9_]/g, "");
    const properties = Object.fromEntries(
      Object.entries(options).map(([key, value]) => {
        const newKey = `caddy_0.${current}_handle.${key}`;
        return [newKey, value];
      })
    );

    return {
      [`caddy_0.${current}_@${name}`]: `host ${subdomain}.${rootDomain}`,
      [`caddy_0.${current}_handle`]: `@${name}`,
      [`caddy_${current}`]: `http://${name}`,
      [`caddy_${current}.redir`]: `https://${subdomain}.${rootDomain}{uri}`,
      ...properties,
    };
  }

  return {
    usingUpstreams,
    subdomainDefinition,
    root,
  };
}
