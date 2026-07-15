const KEY_BINDINGS = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "shoot",
  KeyJ: "pass",
  KeyK: "action",
  KeyL: "switch",
  Tab: "switch",
  KeyV: "camera",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  Escape: "pause",
  KeyP: "pause",
};

export class InputManager {
  constructor() {
    this.held = new Set();
    this.pressed = new Set();
    this.released = new Set();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onWindowBlur = this.onWindowBlur.bind(this);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
  }

  bindTouchButtons(root) {
    if (!root) {
      return;
    }

    for (const button of root.querySelectorAll("[data-action]")) {
      const action = button.dataset.action;

      const press = (event) => {
        event.preventDefault();
        if (!this.held.has(action)) {
          this.pressed.add(action);
        }
        this.held.add(action);
        button.classList.add("active");
      };

      const release = (event) => {
        event.preventDefault();
        if (this.held.has(action)) {
          this.released.add(action);
        }
        this.held.delete(action);
        button.classList.remove("active");
      };

      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointerleave", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("contextmenu", (event) => event.preventDefault());
    }
  }

  onKeyDown(event) {
    const action = KEY_BINDINGS[event.code];
    if (!action) {
      return;
    }

    if (event.code === "Tab" || event.code === "Space") {
      event.preventDefault();
    }

    if (!event.repeat) {
      this.pressed.add(action);
    }

    this.held.add(action);
  }

  onKeyUp(event) {
    const action = KEY_BINDINGS[event.code];
    if (!action) {
      return;
    }

    if (this.held.has(action)) {
      this.released.add(action);
    }
    this.held.delete(action);
  }

  onWindowBlur() {
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
  }

  isDown(action) {
    return this.held.has(action);
  }

  consumePress(action) {
    const pressed = this.pressed.has(action);
    if (pressed) {
      this.pressed.delete(action);
    }
    return pressed;
  }

  consumeRelease(action) {
    const released = this.released.has(action);
    if (released) {
      this.released.delete(action);
    }
    return released;
  }

  getMovementVector() {
    const x = (this.isDown("up") ? 1 : 0) - (this.isDown("down") ? 1 : 0);
    const z = (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0);
    return { x, z };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}
