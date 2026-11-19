import { mount } from "svelte";

import App from "./app/App.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("The Bob Gacha mount element is missing.");
}

mount(App, { target });
