import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenApiDocument } from "./openApiConnector";

test("P5 OpenAPI JSON discovery normalizes operations without executing them", () => {
  const result = parseOpenApiDocument({
    openapi:"3.1.0",
    info:{title:"Portfolio API",version:"1.0"},
    servers:[{url:"https://api.example.com"}],
    paths:{
      "/positions":{get:{operationId:"listPositions",summary:"List positions",tags:["portfolio"],parameters:[{name:"account",in:"query",required:true}]}},
      "/orders":{post:{summary:"Create order"}},
    },
  });
  assert.equal(result.specification,"openapi3");
  assert.equal(result.operations.length,2);
  assert.equal(result.operations[0].operationId,"listPositions");
  assert.equal(result.operations[0].parameters[0].required,true);
});
