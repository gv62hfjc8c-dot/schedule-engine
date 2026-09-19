import { useState } from "react";
import type { Pessoa } from "./types";
import { generateSchedule } from "./utils/generateSchedule";
import { validateSchedule } from "./utils/validateSchedule";

const initialPessoas: Pessoa[] = [
  { id: "1", nome: "Pessoa 1" },
  { id: "2", nome: "Pessoa 2" },
  { id: "3", nome: "Pessoa 3" },
];

const dias = [
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
];

const WEEK_START = "2026-09-14";

const datas = [
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
];

export default function App() {
  const [pessoas, setPessoas] = useState<Pessoa[]>(initialPessoas);

  const [nome, setNome] = useState("");

  const schedule = generateSchedule(pessoas, WEEK_START);

  const validation = validateSchedule(
    pessoas,
    schedule,
    WEEK_START
  );

  const adicionarPessoa = () => {
    const nomeNormalizado = nome.trim();

    if (!nomeNormalizado) return;

    const pessoa: Pessoa = {
      id: crypto.randomUUID(),
      nome: nomeNormalizado,
    };

    setPessoas((prev) => [...prev, pessoa]);
    setNome("");
  };

  const removerPessoa = (id: string) => {
    setPessoas((prev) => prev.filter((pessoa) => pessoa.id !== id));
  };

  return (
    <main
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        padding: 32,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Schedule Engine</h1>

      <p>
        V0 — Segunda a sexta · 08:30–19:00 · 8h/dia · 40h/semana
      </p>

      <section
        style={{
          marginTop: 32,
          padding: 20,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
      >
        <h2>Pessoas</h2>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            placeholder="Nome da pessoa"
          />

          <button onClick={adicionarPessoa}>
            Adicionar
          </button>
        </div>

        <ul>
          {pessoas.map((pessoa) => (
            <li key={pessoa.id} style={{ marginTop: 8 }}>
              {pessoa.nome}

              <button
                onClick={() => removerPessoa(pessoa.id)}
                style={{ marginLeft: 8 }}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section
        style={{
          marginTop: 32,
          padding: 20,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
      >
        <h2>Horário</h2>

        <p>
          Horário gerado automaticamente pelo Generator V0.
        </p>

        <p>
          Estado: {validation.valid ? "Válido" : "Inválido"}
        </p>

        {validation.errors.length > 0 && (
          <ul>
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: 16,
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>
                Pessoa
              </th>

              {dias.map((dia) => (
                <th
                  key={dia}
                  style={{ textAlign: "center", padding: 8 }}
                >
                  {dia}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {pessoas.map((pessoa) => (
              <tr key={pessoa.id}>
                <td style={{ padding: 8 }}>
                  {pessoa.nome}
                </td>

                {datas.map((date) => {
                  const scheduleKey = `${pessoa.id}::${date}`;
                  const cell = schedule[scheduleKey];

                  return (
                    <td
                      key={date}
                      style={{
                        textAlign: "center",
                        padding: 8,
                        border: "1px solid #ddd",
                      }}
                    >
                      {cell?.shift ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}