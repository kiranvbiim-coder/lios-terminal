/**
 * LangAlpha-derived bounded workflow JSON-reply selection.
 * Source: ginlix-ai/LangAlpha@941ca4a18f5a364caf481a6f78cdb040086aa38d
 *   src/ptc_agent/agent/middleware/background_subagent/workflow/validation.py:
 *   parse_schema_result, _MAX_JSON_CANDIDATES and bounded response diagnostics.
 *
 * LiOS adaptation: the canonical GM agent loop owns planning/review schemas,
 * delegation, budget, project permission and tool registry. This only selects
 * a JSON OBJECT from bounded untrusted model text; no LangAlpha QuickJS,
 * model provider, background scheduler, DB, validator or separate runtime.
 */
export const LANGALPHA_MODEL_REPLY_SOURCE = Object.freeze({
  repository: "ginlix-ai/LangAlpha",
  commit: "941ca4a18f5a364caf481a6f78cdb040086aa38d",
  license: "Apache-2.0",
  installedDonorRuntime: false,
});

const MAX_REPLY_CHARS = 256_000;
const MAX_CANDIDATES = 32;
const MAX_OBJECT_CHARS = 128_000;
const MAX_DEPTH = 80;

export class BoundedModelReplyError extends Error {
  constructor(readonly kind: "no_object" | "malformed" | "too_large") {
    super(kind === "no_object"
      ? "The model did not return a JSON object."
      : kind === "too_large"
        ? "The model response exceeded the bounded JSON parsing limit."
        : "The model returned malformed JSON.");
    this.name = "BoundedModelReplyError";
  }
}

function endOfObject(text: string, start: number): number {
  const stack: string[] = [];
  let quoted = false, escaped = false;
  for (let i=start;i<text.length && i-start<MAX_OBJECT_CHARS;i++) {
    const c=text[i];
    if(quoted){
      if(escaped){escaped=false;continue;}
      if(c==="\\"){escaped=true;continue;}
      if(c==='"'){quoted=false;}
      continue;
    }
    if(c==='"'){quoted=true;continue;}
    if(c==="{"||c==="["){
      stack.push(c);
      if(stack.length>MAX_DEPTH)return -1;
    }else if(c==="}"||c==="]"){
      const expected=c==="}"?"{":"[";
      if(stack.pop()!==expected)return -1;
      if(stack.length===0)return i+1;
    }
  }
  return -1;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value==="object" && value!==null && !Array.isArray(value);
}

/**
 * Bounded donor-style candidate scan. JSON.parse never processes an unbounded
 * blob, JSON within a fenced block is accepted, and braces in surrounding prose
 * cannot corrupt the last closing brace. The GM Zod plan/review validator
 * remains authoritative and rejects extra keys, invalid tool shapes or roles.
 */
export function parseBoundedAgentModelObject(text: string): Record<string, unknown> {
  if(typeof text!=="string")throw new BoundedModelReplyError("malformed");
  if(text.length>MAX_REPLY_CHARS)throw new BoundedModelReplyError("too_large");
  let attempts=0;
  let first:Record<string,unknown>|null=null;
  for(let i=0;i<text.length;i++){
    if(text[i]!=="{")continue;
    if(++attempts>MAX_CANDIDATES)break;
    const end=endOfObject(text,i);
    if(end<0)continue;
    try{
      const object:unknown=JSON.parse(text.slice(i,end));
      if(!plainObject(object))continue;
      if(first===null)first=object;
      if(Object.hasOwn(object,"steps")||Object.hasOwn(object,"decision"))return object;
    }catch{
      // A model may write commentary/brackets around its JSON; no raw parser
      // errors or untrusted response content enter retry prompts or receipts.
    }
  }
  if(first!==null)return first;
  throw new BoundedModelReplyError(attempts===0?"no_object":"malformed");
}
