"use client";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => unknown;
};
type ModelDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: Tool,
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};
export function useWebMcp(actions: {
  read: () => unknown;
  start: () => void;
  pause: () => void;
}) {
  const current = useRef(actions);
  useEffect(() => {
    current.current = actions;
  });
  useEffect(() => {
    const context = (document as ModelDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const schema = {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
    const validate = (input: unknown) => {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length
      )
        throw new Error("Expected an empty object");
    };
    const definitions = [
      {
        name: "read_focus_state",
        description:
          "Read the current timer and this week’s recorded focus time.",
        action: "read" as const,
      },
      {
        name: "start_focus_timer",
        description:
          "Start or resume the visible focus timer. Fails during breaks or when another tab owns the timer.",
        action: "start" as const,
      },
      {
        name: "pause_focus_timer",
        description:
          "Pause the currently running focus timer without saving a completed session.",
        action: "pause" as const,
      },
    ];
    for (const definition of definitions) {
      try {
        void Promise.resolve(
          context.registerTool(
            {
              name: definition.name,
              description: definition.description,
              inputSchema: schema,
              annotations: { readOnlyHint: definition.action === "read" },
              execute(input) {
                validate(input);
                if (definition.action !== "read")
                  flushSync(() => current.current[definition.action]());
                return current.current.read();
              },
            },
            { signal: lifecycle.signal },
          ),
        ).catch(() => {
          /* optional browser capability */
        });
      } catch {
        /* normal UI remains available */
      }
    }
    return () => lifecycle.abort();
  }, []);
}
