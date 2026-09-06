// Tests preload this module; the production manifest never includes the fixture.
import { runtimes } from "../../runtimes.mjs";
export const dummyEntry = {
  id: "dummy", declaration: {attr:"data-akari-dummy-scene"}, browserGlobal:"dummyRuntime",
  scripts:[{path:"test-harness/fixtures/dummy-runtime.js"}], usesVideoTextures:false,
  assetReferences(descriptor) {
    if (typeof descriptor?.image !== "string" || !/^[\w.-]+$/.test(descriptor.image)) throw new TypeError("dummy image must be a relative file name");
    return [{role:"dummy-image", path:descriptor.image, field:["image"], mime:"image/png"}];
  },
  appliesTo: () => true,
  validate(descriptor, ctx) {
    if (descriptor?.color !== "blue") return ["dummy color must be blue"];
    ctx.validateReference(descriptor.image);
    return [];
  },
};
runtimes.push(dummyEntry);
