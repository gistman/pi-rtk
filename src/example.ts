import { createPiRtkExtension } from "./extension.js";

export default createPiRtkExtension({
  binaryPath: process.env.PI_RTK_BINARY || "rtk"
});
