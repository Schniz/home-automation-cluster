#!/usr/bin/env node -r @swc-node/register

import machine1 from "../src/machine1";
import yaml from "js-yaml";
import { command, positional, binary, run, string, extendType } from "cmd-ts";
import fs from "fs";

const StreamFromPath = extendType(string, {
  description: `A path to a file or directory, or provide \`-\` for stdout.`,
  displayName: "output",
  async from(path: string) {
    if (path === "-") {
      return process.stdout;
    }

    try {
      return fs.createWriteStream(path);
    } catch (err) {
      err.message = `Error creating ${path}: ${err.message}`;
      throw err;
    }
  },
});

const cmd = command({
  name: "generate",
  description: "Generate a docker-compose yaml file",
  args: {
    output: positional({
      type: StreamFromPath,
    }),
  },
  async handler({ output }) {
    const dumped = yaml.dump(machine1());
    output.write(dumped);
    output.write("\n");
  },
});

run(binary(cmd), process.argv);
