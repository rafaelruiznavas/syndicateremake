// Bus de eventos mínimo para desacoplar la simulación del audio y la interfaz.

export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) { (this.handlers.get(type) ?? this.handlers.set(type, []).get(type)).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const l = this.handlers.get(type); if (l) l.splice(l.indexOf(fn) >>> 0, 1); }
  emit(type, payload) { for (const fn of this.handlers.get(type) ?? []) fn(payload); }
}
