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
        const newKey = `caddy.${current}_handle.${key}`;
        return [newKey, value];
      })
    );

    // Add HTTP redirect for bare subdomain to HTTPS FQDN
    const redirectIndex = ++index;
    const redirectProperties = {
      [`caddy.${redirectIndex}_@${name}_bare`]: `host ${subdomain}`,
      [`caddy.${redirectIndex}_handle`]: `@${name}_bare`,
      [`caddy.${redirectIndex}_handle.redir`]: `https://${subdomain}.${rootDomain}{uri}`,
    };

    return {
      [`caddy.${current}_@${name}`]: `host ${subdomain}.${rootDomain}`,
      [`caddy.${current}_handle`]: `@${name}`,
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
