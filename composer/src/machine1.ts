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
  audiobooks: path.join(LIBRARY_ROOT, "audiobooks"),
  podcasts: path.join(LIBRARY_ROOT, "podcasts"),
};
function configDir(name: string) {
  return path.join(CONFIGS_ROOT, name);
}

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
      watchtower: service("watchtower", (helpers) => ({
        image: "containrrr/watchtower",
        container_name: "watchtower",
        environment: ["DOCKER_CONFIG=/config/docker"],
        volumes: [
          "/var/run/docker.sock:/var/run/docker.sock",
          `${helpers.config}:/config`,
        ],
        command: [
          `--cleanup`,
          `--notification-url`,
          `/config/notification_url`,
        ],
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
          { published: 443, target: 443 },
          { published: 80, target: 80 },
        ],
        labels: {
          ...caddy.root(),
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
          ...caddy.subdomainDefinition("esphome", {
            reverse_proxy: `http://${machines.main}:6052`,
          }),
          ...caddy.subdomainDefinition("upsnap", {
            reverse_proxy: `http://${machines.main}:8090`,
          }),
          ...caddy.subdomainDefinition("dns", {
            reverse_proxy: `http://${machines.main}:8881`,
            redir: "/ /admin",
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
          `${LIBRARY_ROOT}:/library_root`,
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
          `${LIBRARY_ROOT}:/library_root`,
          `${library.downloads}:/downloads`,
        ],
      })),

      headphones: service("headphones", (helpers) => ({
        image: "lscr.io/linuxserver/headphones:latest",
        container_name: "headphones",
        networks: ["caddy"],
        labels: {
          ...caddy.usingUpstreams("headphones", 8181),
        },
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${helpers.config}:/config`,
          `${LIBRARY_ROOT}/music:/music`,
          `${LIBRARY_ROOT}:/library_root`,
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
          `${LIBRARY_ROOT}:/library_root`,
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
          `${LIBRARY_ROOT}:/library_root`,
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
        restart: "unless-stopped",
      })),

      esphome: service("esphome", (helpers) => ({
        container_name: "esphome",
        image: "ghcr.io/esphome/esphome",
        volumes: [
          `${helpers.config}:/config`,
          `/etc/localtime:/etc/localtime:ro`,
        ],
        environment: [
          "TZ=Asia/Jerusalem",
          "ESPHOME_DASHBOARD_USE_PING=true",
          "ESPHOME_DASHBOARD_RELATIVE_URL=/",
          "ESPHOME_QUICKWIZARD=",
          "ESPHOME_IS_HA_ADDON=",
          "DISABLE_HA_AUTHENTICATION=",
        ],
        network_mode: "host",
        privileged: true,
        env_file: "./esphome/environment",
        restart: "unless-stopped",
      })),

      pihole: service("pihole", (helpers) => ({
        container_name: "pihole",
        image: "pihole/pihole:latest",
        ports: ["53:53/tcp", "53:53/udp", "67:67/udp", "8881:80/tcp"],
        environment: ["TZ=Asia/Jerusalem"],
        env_file: "./pihole/environment",
        volumes: [
          `${helpers.config}/etc-pihole:/etc/pihole`,
          `${helpers.config}/etc-dnsmasq.d:/etc/dnsmasq.d`,
        ],
        cap_add: ["NET_ADMIN"],
      })),

      upsnap: service("upsnap", (helpers) => ({
        image: "ghcr.io/seriousm4x/upsnap:4",
        environment: [
          "TZ=Asia/Jerusalem",
          "PUID=1000",
          "PGID=1000",
          "UPSNAP_SCAN_RANGE=192.168.31.0/24",
          "UPSNAP_PING_PRIVILEGED=true",
        ],
        network_mode: "host",
        healthcheck: {
          test: "curl -fs http://localhost:8090/api/health || exit 1",
        },
        volumes: [`${helpers.config}/data:/data`],
      })),

      audiobookshelf: service("audiobookshelf", (helpers) => ({
        image: "ghcr.io/advplyr/audiobookshelf:latest",
        container_name: "audiobookshelf",
        networks: ["caddy"],
        environment: ["PUID=1000", "PGID=1000", "TZ=Asia/Jerusalem"],
        volumes: [
          `${library.audiobooks}:/audiobooks`,
          `${library.podcasts}:/podcasts`,
          `${helpers.config}:/config`,
          `${helpers.config}/metadata:/metadata`,
        ],
        labels: {
          ...caddy.usingUpstreams("audiobooks", 80),
        },
      })),

      opencode: service("opencode-web", (helpers) => ({
        image: "ghcr.io/schniz/opencode-web-bun:main",
        container_name: "opencode-web",
        networks: ["caddy"],
        environment: [
          "PUID=1000",
          "PGID=1000",
          "TZ=Asia/Jerusalem",
          "PORT=3000",
          "OPENCODE_WEB_REPOS_PATH=/repos",
          "OPENCODE_WEB_GH_SETUP_GIT=1",
        ],
        volumes: [
          `${helpers.config}/auth.json:/root/.local/share/opencode/auth.json`,
          `${helpers.config}/gh:/root/.config/gh`,
          `${LIBRARY_ROOT}/opencode/repos:/repos`,
          `${LIBRARY_ROOT}/opencode/share:/root/.local/share/opencode/project`,
        ],
        labels: {
          ...caddy.usingUpstreams("opencode", 3000),
        },
      })),
    },
  };
}
