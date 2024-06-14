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
  git: path.join(LIBRARY_ROOT, "git"),
};
function configDir(name: string) {
  return path.join(CONFIGS_ROOT, name);
}

const logging = {
  driver: "fluentd",
};

const machines = {
  main: "192.168.31.38",
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
      watchtower: service("watchtower", () => ({
        image: "containrrr/watchtower",
        container_name: "watchtower",
        volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
        command: "--cleanup",
        logging,
      })),
      gitea: service("gitea", () => ({
        image: "gitea/gitea",
        container_name: "gitea",
        networks: ["caddy"],
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${library.git}/gitea/conf:/etc/gitea`,
          `${library.git}/:/data`,
          `/etc/timezone:/etc/timezone:ro`,
          `/etc/localtime:/etc/localtime:ro`,
        ],
        logging,
        labels: {
          ...caddy.usingUpstreams("git", 3000),
        },
        ports: ["2222:2222"],
      })),
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
            reverse_proxy: `http://${machines.main}:8123`,
          }),
          ...caddy.subdomainDefinition("media", {
            reverse_proxy: `http://${machines.main}:8096`,
          }),
        },
      })),

      ollama: service("ollama", (helpers) => ({
        container_name: "ollama",
        image: "ollama/ollama",
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("ai-api", 11434),
        },
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [`${helpers.config}:/root/.ollama`],
        logging,
      })),

      ollama_web: service("ollama_web", (helpers) => ({
        container_name: "ollama_web",
        image: "ghcr.io/open-webui/open-webui:main",
        networks: ["caddy"],
        logging,
        labels: {
          ...caddy.usingUpstreams("ai", 8080),
        },
        environment: [
          "PUID=1000",
          "PGID=1000",
          "TZ=Asia/Jerusalem",
          "OLLAMA_BASE_URL=https://ai-api.home.hagever.com",
        ],
        volumes: [`${helpers.config}:/app/backend/data`],
      })),

      krembo: service("krembo", (helpers) => ({
        container_name: "krembo",
        image: "ghcr.io/schniz/krembo:main",
        networks: ["caddy"],
        logging,
        labels: {
          ...caddy.usingUpstreams("krembo", 16661),
        },
        environment: [
          "PUID=1000",
          "PGID=1000",
          "TZ=Asia/Jerusalem",
          "PORT=16661",
        ],
        command: [
          "--docker.socket=/var/run/docker.sock",
          "--mdns.enabled",
          "/apps",
        ],
        volumes: [
          `${helpers.config}:/app/backend/data`,
          "/var/run/docker.sock:/var/run/docker.sock",
          `${LIBRARY_ROOT}/krembo_apps:/apps`,
        ],
      })),

      transmission: service("transmission", (helpers) => ({
        container_name: "transmission",
        image: "linuxserver/transmission",
        networks: ["caddy"],
        logging,
        labels: {
          ...caddy.usingUpstreams("torrent", 9091),
        },
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${library.downloads}:/downloads`,
          `${helpers.config}:/config`,
        ],
      })),

      // "cloudflare-ddns": service("cloudflare-ddns", () => ({
      //   image: "oznu/cloudflare-ddns:latest",
      //   env_file: "./cloudflare-ddns/environment",
      //   environment: ["ZONE=hagever.com", "SUBDOMAIN=v", "PROXIED=false"],
      // })),

      jackett: service("jackett", (helpers) => ({
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("jackett", 9117),
        },
        image: "linuxserver/jackett:latest",
        container_name: "jackett",
        logging,
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
        logging,
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
        logging,
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
        logging,
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
        logging,
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
        logging,
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
        logging,
      })),

      filebrowser: service("filebrowser", (helpers) => {
        const settings = path.join(helpers.config, "settings");
        const database = path.join(helpers.config, "db");
        return {
          image: "filebrowser/filebrowser:s6",
          container_name: "filebrowser",
          networks: ["caddy"],
          environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
          logging,
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
        logging,
      })),

      homeassistant: service("homeassistant", (helpers) => ({
        container_name: "homeassistant",
        image: "ghcr.io/home-assistant/home-assistant:stable",
        environment: ["TZ=Asia/Jerusalem"],
        volumes: [
          `/media/SchlezExt2/homeassistant-config:/config`,
          "/etc/localtime:/etc/localtime:ro",
          "/run/dbus:/run/dbus:ro",
          `${LIBRARY_ROOT}:/library`,
        ],
        privileged: true,
        network_mode: "host",
        logging,
        restart: "unless-stopped",
      })),

      openobserve: service("openobserve", (helpers) => {
        const data = path.join(helpers.config, "data");
        return {
          image: "public.ecr.aws/zinclabs/openobserve:latest",
          container_name: "openobserve",
          networks: ["caddy"],
          env_file: "./openobserve/environment",
          environment: [
            "PUID=1000",
            "PGID=1000",
            "TZ=Asia/Jerusalem",
            "ZO_DATA_DIR=/data",
          ],
          volumes: [`${data}:/data`],
          labels: {
            ...caddy.usingUpstreams("o11y", 5080),
          },
        };
      }),

      fluentbit: service("fluentbit", (helpers) => {
        const configs = Object.entries({
          format: "json",
          Host: "openobserve",
          HTTP_User: "$${ZO_ROOT_USER_EMAIL}",
          Port: 5080,
          Json_date_key: "_timestamp",
          Json_date_format: "iso8601",
          compress: "gzip",
          URI: "/api/default/default/_json",
          HTTP_Passwd: "$${ZO_HTTP_PASSWD}",
        }).flatMap(([key, value]) => [`-p`, `${key}=${value}`]);
        return {
          image: "fluent/fluent-bit:latest",
          container_name: "fluentbit",
          networks: ["caddy"],
          environment: ["TZ=Asia/Jerusalem"],
          env_file: "./openobserve/environment",
          volumes: [`${helpers.config}:/config`],
          ports: ["127.0.0.1:24224:24224"],
          command: [
            "/fluent-bit/bin/fluent-bit",
            "-i",
            "forward",
            "-o",
            "http",
            ...configs,
            "-f",
            "1",
          ],
        };
      }),
    },
  };
}
