/**
 * Tool parser — model response'tan XML-style tool çağrılarını çıkarır.
 *
 * Cline pattern:
 *   <read_file>
 *     <path>src/foo.js</path>
 *   </read_file>
 *
 *   <execute_command>
 *     <command>npm test</command>
 *   </execute_command>
 *
 *   <attempt_completion>
 *     <result>Görev tamamlandı</result>
 *   </attempt_completion>
 *
 * Bir response birden fazla tool içerebilir; biz **ilk tool'u** alıyoruz
 * (sequential execution). Tool sonrası sonuç model'e ekleyip tekrar çağrılır.
 */

const TOOL_NAMES = [
  "read_file",
  "write_to_file",
  "execute_command",
  "list_files",
  "ask_followup_question",
  "attempt_completion",
];

/**
 * @param {string} response - Model'in tam metin yanıtı
 * @returns {{ tool: string, params: object, rawMatch: string, before: string, after: string } | null}
 */
function extractFirstTool(response) {
  if (!response) return null;
  for (const name of TOOL_NAMES) {
    const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i");
    const m = response.match(re);
    if (!m) continue;
    const inner = m[1];
    const params = parseInnerParams(inner);
    return {
      tool: name,
      params,
      rawMatch: m[0],
      before: response.slice(0, m.index).trim(),
      after: response.slice(m.index + m[0].length).trim(),
    };
  }
  return null;
}

/**
 * Inner XML — her child tag parameter. Örn:
 *   <path>src/foo.js</path>  →  { path: "src/foo.js" }
 *   <content>...</content>   →  { content: "..." }
 *   <command>npm test</command>  →  { command: "npm test" }
 */
function parseInnerParams(inner) {
  const params = {};
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    params[m[1]] = m[2].trim();
  }
  return params;
}

module.exports = { extractFirstTool, TOOL_NAMES };
