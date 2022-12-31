import { createCaddyProxy } from "./createCaddyProxy";
import path from "path";
import {
  ComposeSpecification,
  DefinitionsService,
} from "../generated/docker-compose-spec";

const LIBRARY_ROOT = "/media/SchlezExt2/library";
const CONFIGS_ROOT = "/media/SchlezExt2/configs";
const library = {
  tv: path.join(LIBRARY_ROOT, "tv"),
  movies: path.join(LIBRARY_ROOT, "movies"),
  downloads: path.join(LIBRARY_ROOT, "downloads"),
};
function configDir(name: string) {
  return path.join(CONFIGS_ROOT, name);
}

const machines = {
  pi0: "192.168.31.89",
  pi1: "192.168.31.174",
};

type ServiceHelpers = {
  config: string;
};

/** Defines a service with defaults and helpers */
function service(
  name: string,
  fn: (helpers: ServiceHelpers) => DefinitionsService
): DefinitionsService {
  const config = configDir(name);

  return {
    restart: "unless-stopped",
    ...fn({
      config,
    }),
  };
}

export default function machine1(): ComposeSpecification {
  const caddy = createCaddyProxy({ rootDomain: "home.hagever.com" });

  return {
    version: "3",
    networks: {
      caddy: {
        external: true,
      },
    },
    services: {
      caddy: service("caddy", (helpers) => ({
        image: "ghcr.io/schniz/home-automation-cluster-caddy:main",
        env_file: "./caddy/environment",
        environment: {
          CADDY_INGRESS_NETWORKS: "caddy",
        },
        container_name: "caddy",
        networks: ["caddy"],
        volumes: [
          `${helpers.config}/data/:/data/caddy/`,
          "/var/run/docker.sock:/var/run/docker.sock",
        ],
        ports: [
          {
            published: 443,
            target: 443,
          },
          {
            published: 80,
            target: 80,
          },
        ],
        labels: {
          ...caddy.root(),
          "caddy.tls.dns": "cloudflare {env.CF_API_TOKEN}",
          ...caddy.subdomainDefinition("caddy", {
            request_header: `Host "localhost:2019"`,
            reverse_proxy: "http://localhost:2019",
          }),
          ...caddy.subdomainDefinition("ha", {
            reverse_proxy: `http://${machines.pi1}:8123`,
          }),
          ...caddy.subdomainDefinition("media", {
            reverse_proxy: `http://${machines.pi0}:8096`,
          }),
        },
      })),

      transmission: service("transmission", (helpers) => ({
        container_name: "transmission",
        image: "linuxserver/transmission",
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("torrent", 9091),
        },
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${library.downloads}:/downloads`,
          `${helpers.config}:/config`,
        ],
      })),

      "cloudflare-ddns": service("cloudflare-ddns", () => ({
        image: "oznu/cloudflare-ddns:latest",
        env_file: "./cloudflare-ddns/environment",
        environment: ["ZONE=hagever.com", "SUBDOMAIN=v", "PROXIED=false"],
      })),

      jackett: service("jackett", (helpers) => ({
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("jackett", 9117),
        },
        image: "linuxserver/jackett:latest",
        container_name: "jackett",
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [`${helpers.config}:/config`],
      })),

      sonarr: service("sonarr", (helpers) => ({
        image: "linuxserver/sonarr:latest",
        container_name: "sonarr",
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("sonarr", 8989),
        },
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${helpers.config}:/config`,
          `${library.tv}:/tv`,
          `${library.downloads}:/downloads`,
        ],
      })),

      radarr: service("radarr", (helpers) => ({
        image: "linuxserver/radarr:latest",
        container_name: "radarr",
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("radarr", 7878),
        },
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${helpers.config}:/config`,
          `${library.movies}:/movies`,
          `${library.downloads}:/downloads`,
        ],
      })),

      bazarr: service("bazarr", (helpers) => ({
        image: "linuxserver/bazarr:latest",
        container_name: "bazarr",
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("bazarr", 6767),
        },
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${helpers.config}:/config`,
          `${library.movies}:/movies`,
          `${library.tv}:/tv`,
        ],
      })),

      jellyfin: service("jellyfin", (helpers) => ({
        image: "linuxserver/jellyfin",
        container_name: "jellyfin",
        network_mode: "host",
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${helpers.config}:/config`,
          `${library.tv}:/data/tvshows`,
          `${library.movies}:/data/movies`,
          {
            type: "tmpfs",
            target: "/tmp-transcoding",
          },
        ],
      })),

      ical_http_sensor: service("ical_http_sensor", () => ({
        image: "ghcr.io/schniz/ical_http_server:main",
        container_name: "ical-http-sensor",
        environment: ["TZ=Asia/Jerusalem"],
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("ical-sensor", 8080),
        },
      })),

      tailscale: service("tailscale", () => ({
        image: "tailscale/tailscale",
        privileged: true,
        container_name: "tailscale",
        hostname: "homelab.vpn.hagever.com",
        network_mode: "host",
        env_file: "./tailscale/environment",
        environment: ["TZ=Asia/Jerusalem"],
        volumes: ["/var/lib:/var/lib", "/dev/net/tun:/dev/net/tun"],
      })),

      filebrowser: service("filebrowser", (helpers) => {
        const settings = path.join(helpers.config, "settings");
        const database = path.join(helpers.config, "db");
        return {
          image: "filebrowser/filebrowser:s6",
          container_name: "filebrowser",
          networks: ["caddy"],
          environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
          volumes: [
            `${settings}:/config`,
            `${database}:/database`,
            `${library.downloads}:/downloads`,
            `/media/SchlezExt2:/srv`,
          ],
          labels: {
            ...caddy.usingUpstreams("files", 80),
          },
        };
      }),

      mosquitto: service("mosquitto", (helpers) => ({
        image: "eclipse-mosquitto:latest",
        container_name: "mosquitto",
        networks: ["caddy"],
        environment: ["TZ=Asia/Jerusalem"],
        volumes: [`${helpers.config}:/mosquitto`],
        ports: [
          {
            published: 1883,
            target: 1883,
          },
        ],
      })),
    },
  };
}
