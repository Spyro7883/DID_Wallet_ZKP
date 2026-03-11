const { Buffer } = require("buffer");
(globalThis as any).Buffer = Buffer;

const { registerRootComponent } = require("expo");
const App = require("./App").default;

registerRootComponent(App);
