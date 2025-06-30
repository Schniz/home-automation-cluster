export function createCaddyProxy({ rootDomain }: { rootDomain: string }) {
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
      caddy: `*.${rootDomain}`,
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

    const redirectProperties = {
      [`caddy_1`]: `http://${name}`,
      [`caddy_1.redir`]: `https://${subdomain}.${rootDomain}{uri}`,
    };

    return {
      [`caddy_0.${current}_@${name}`]: `host ${subdomain}.${rootDomain}`,
      [`caddy_0.${current}_handle`]: `@${name}`,
      ...properties,
      ...redirectProperties,
    };
  }

  return {
    usingUpstreams,
    subdomainDefinition,
    root,
  };
}
