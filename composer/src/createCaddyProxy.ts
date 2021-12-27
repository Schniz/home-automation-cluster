export function createCaddyProxy() {
  let index = 0;

  function usingUpstreams(
    subdomain: string,
    port: number
  ): Record<string, string> {
    return {
      ...root(),
      ...subdomainDefinition(subdomain, {
        reverse_proxy: `{{upstreams ${port}}}`,
      }),
    };
  }

  function root() {
    return {
      caddy: "*.{$ROOT_DOMAIN}",
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
        const newKey = `caddy.${current}_handle.${key}`;
        return [newKey, value];
      })
    );

    return {
      [`caddy.${current}_@${name}`]: `host ${subdomain}.{$ROOT_DOMAIN}`,
      [`caddy.${current}_handle`]: `@${name}`,
      ...properties,
    };
  }

  return {
    usingUpstreams,
    subdomainDefinition,
    root,
  };
}
