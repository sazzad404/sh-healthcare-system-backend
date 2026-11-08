import { createClient } from "redis";
import config from "../config";

export const radisClient = createClient({
  username: config.radis_user,
  password: config.radis_password,
  socket: {
    host: config.radis_host,
    port: Number(config.radis_port),
  },
});
