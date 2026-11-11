// Patches the installed onstarjs2 bundle (runs as this package's postinstall).
//
// Why: onstarjs2 2.16.7 reacts to a GM token response without vehicle info by
// renaming the saved tokens to *.old and starting a scripted browser login.
// GM's bot detection rejects that login ("Access Denied" / an unrecognised
// "Verify it's you" page), and every retry extends the block. See
// https://github.com/BigThunderSR/onstar2mqtt/issues/1070
//
// The patch makes the library:
//   1. keep the saved tokens when GM's token lacks vehicle info (just fail the request)
//   2. refuse the browser login unless ONSTAR_BROWSER_LOGIN=true
//   3. make a single browser login attempt instead of five when it is enabled
//
// The build fails if the expected code is not found, so a library upgrade
// can't silently drop these protections.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MARKER = "/* onstar2ha-patch */";
const dist = fileURLToPath(
  new URL("../node_modules/onstarjs2/dist/", import.meta.url),
);

const replacements = [
  {
    name: "keep tokens when vehicle info is missing",
    find: 'console.log("Returned GM API token was missing vehicle information. Deleting existing tokens for reauth.");',
    replace:
      `${MARKER} throw new Error("GM API token was missing vehicle information; keeping saved tokens and retrying later.");`,
  },
  {
    name: "gate and limit browser login",
    find: "const maxRetries = 4;",
    replace:
      `${MARKER} if (String(process.env.ONSTAR_BROWSER_LOGIN).toLowerCase() !== "true") {` +
      ` throw new Error("Manual sign-in required: no usable saved login and browser login is disabled (ONSTAR_BROWSER_LOGIN). Create microsoft_tokens.json with the OnStar Auth Token Saver Firefox extension (https://github.com/metheos/onstar_firefox) and place it in the token folder."); }` +
      ` const maxRetries = 0;`,
  },
];

if (!existsSync(dist)) {
  console.error(`patch-onstarjs: ${dist} not found - is onstarjs2 installed?`);
  process.exit(1);
}

for (const file of ["index.mjs", "index.cjs"]) {
  const path = `${dist}${file}`;
  let source = readFileSync(path, "utf8");
  if (source.includes(MARKER)) {
    console.log(`patch-onstarjs: ${file} already patched`);
    continue;
  }
  for (const { name, find, replace } of replacements) {
    const count = source.split(find).length - 1;
    if (count !== 1) {
      console.error(
        `patch-onstarjs: cannot apply "${name}" to ${file} (expected 1 match, found ${count}). ` +
          "onstarjs2 has changed; review scripts/patch-onstarjs.mjs before upgrading.",
      );
      process.exit(1);
    }
    source = source.replace(find, () => replace);
  }
  writeFileSync(path, source);
  console.log(`patch-onstarjs: patched ${file}`);
}
