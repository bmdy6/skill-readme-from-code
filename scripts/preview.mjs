// A real excerpt of the README artifact, used as a capture input for the hero.
import { readFileSync } from "node:fs";
const text = readFileSync("README.md", "utf8");
console.log(text.match(/^# .+$/m)?.[0]);
console.log(text.match(/^## Quick start$/m)?.[0]);
console.log(text.match(/```sh\n([\s\S]+?)\n```/)?.[1]);
