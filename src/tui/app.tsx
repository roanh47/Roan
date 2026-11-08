import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { Agent } from "../agent.js";
import { builtinTools } from "../tools.js";
import type { AgentEvent } from "../types.js";
import type { Config } from "../config.js";

type Blok =
  | { soort: "user"; tekst: string }
  | { soort: "assistant"; tekst: string }
  | { soort: "tool"; naam: string; args: string; output: string; ok: boolean }
  | { soort: "fout"; tekst: string };

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function App({ config }: { config: Config }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [blokken, setBlokken] = useState<Blok[]>([]);
  const [invoer, setInvoer] = useState("");
  const [bezig, setBezig] = useState(false);
  const [frame, setFrame] = useState(0);
  const [geschiedenis, setGeschiedenis] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const agent = useRef<Agent | null>(null);
  const streamRef = useRef<string>("");

  if (agent.current === null) {
    agent.current = new Agent({
      provider: config,
      tools: builtinTools,
      systemPrompt: config.systemPrompt,
      cwd: config.cwd,
      onEvent: (e: AgentEvent) => {
        if (e.type === "assistant_text") {
          streamRef.current += e.text;
          const tekst = streamRef.current;
          setBlokken((oud) => {
            const kopie = [...oud];
            const laatste = kopie[kopie.length - 1];
            if (laatste?.soort === "assistant") kopie[kopie.length - 1] = { soort: "assistant", tekst };
            else kopie.push({ soort: "assistant", tekst });
            return kopie;
          });
        } else if (e.type === "tool_start") {
          streamRef.current = "";
          setBlokken((oud) => [
            ...oud,
            { soort: "tool", naam: e.name, args: e.args, output: "", ok: true },
          ]);
        } else if (e.type === "tool_end") {
          setBlokken((oud) => {
            const kopie = [...oud];
            for (let i = kopie.length - 1; i >= 0; i--) {
              const b = kopie[i];
              if (b?.soort === "tool" && b.output === "") {
                kopie[i] = { ...b, output: e.output, ok: e.ok };
                break;
              }
            }
            return kopie;
          });
        } else if (e.type === "error") {
          setBlokken((oud) => [...oud, { soort: "fout", tekst: e.message }]);
        }
      },
    });
  }

  useEffect(() => {
    if (!bezig) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 90);
    return () => clearInterval(t);
  }, [bezig]);

  const verstuur = useCallback(
    async (tekst: string) => {
      const schoon = tekst.trim();
      if (!schoon || bezig) return;
      setInvoer("");
      setHistIdx(-1);
      setGeschiedenis((g) => [schoon, ...g].slice(0, 100));
      setBlokken((oud) => [...oud, { soort: "user", tekst: schoon }]);
      streamRef.current = "";
      setBezig(true);
      try {
        await agent.current!.send(schoon);
      } catch {
        // de fout staat al als blok in beeld
      } finally {
        streamRef.current = "";
        setBezig(false);
      }
    },
    [bezig],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (bezig) return;
    if (key.return) {
      void verstuur(invoer);
      return;
    }
    if (key.backspace || key.delete) {
      setInvoer((v) => v.slice(0, -1));
      return;
    }
    if (key.upArrow && geschiedenis.length > 0) {
      const next = Math.min(histIdx + 1, geschiedenis.length - 1);
      setHistIdx(next);
      setInvoer(geschiedenis[next] ?? "");
      return;
    }
    if (key.downArrow) {
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInvoer(next === -1 ? "" : (geschiedenis[next] ?? ""));
      return;
    }
    if (key.tab) return;
    if (input && !key.ctrl && !key.meta) setInvoer((v) => v + input);
  });

  const hoogte = Math.max(((stdout as unknown as { rows?: number })?.rows ?? 24) - 6, 8);
  const zichtbaar = blokken.slice(-hoogte);

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text color="cyan" bold>
          Roan
        </Text>
        <Text dimColor>
          {config.model} · {config.cwd}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {zichtbaar.length === 0 ? (
          <Text dimColor>Typ een opdracht. Enter verstuurt, Ctrl+C stopt.</Text>
        ) : (
          zichtbaar.map((b, i) => {
            if (b.soort === "user")
              return (
                <Box key={i} marginTop={i === 0 ? 0 : 1}>
                  <Text color="green">› </Text>
                  <Text>{b.tekst}</Text>
                </Box>
              );
            if (b.soort === "assistant")
              return (
                <Box key={i} marginTop={1}>
                  <Text>{b.tekst}</Text>
                </Box>
              );
            if (b.soort === "fout")
              return (
                <Box key={i} marginTop={1}>
                  <Text color="red">✗ {b.tekst}</Text>
                </Box>
              );
            const eersteRegel = b.output.split("\n")[0] ?? "";
            const meer = b.output.split("\n").length - 1;
            return (
              <Box key={i} flexDirection="column" marginTop={1}>
                <Text color={b.ok ? "yellow" : "red"}>
                  {b.ok ? "⚙" : "✗"} {b.naam}{" "}
                  <Text dimColor>{b.args.length > 60 ? b.args.slice(0, 60) + "…" : b.args}</Text>
                </Text>
                {b.output ? (
                  <Text dimColor>
                    {eersteRegel.slice(0, 160)}
                    {meer > 0 ? ` … (+${meer} regels)` : ""}
                  </Text>
                ) : null}
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        {bezig ? (
          <Text color="yellow">
            {FRAMES[frame]} bezig… <Text dimColor>(Ctrl+C stopt)</Text>
          </Text>
        ) : (
          <>
            <Text color="green">› </Text>
            <Text>{invoer}</Text>
            <Text color="green">▌</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
