import test from 'node:test';
import assert from 'node:assert/strict';
import {homeAttentionReadPresentation} from './homeAttentionReadPresentation';
import {projectSavedWorkReadPresentation} from './projectSavedWorkReadPresentation';
test('failed or refreshing Home observations never permit review mutations or invent a verified empty inbox',()=>{
 for(const hasData of [false,true])for(const matchingCount of [0,3]){
  const result=homeAttentionReadPresentation({hasData,matchingCount,failed:true,pending:false,fetching:false});
  assert.equal(result.mayReview,false);
  assert.notEqual(result.emptyText,'No material intelligence currently needs attention.');
  assert.equal(result.countText===null,!hasData);
 }
 assert.equal(homeAttentionReadPresentation({hasData:true,matchingCount:1,failed:false,pending:false,fetching:true}).mayReview,false);
 assert.equal(homeAttentionReadPresentation({hasData:true,matchingCount:1,failed:false,pending:false,fetching:false}).mayReview,true);
});
test('Project resource changes wait for verified reads and read retry cannot duplicate an in-flight request',()=>{
 const ready={chatsFailed:false,resourcesFailed:false,sessionsFailed:false,pending:false,fetching:false};
 assert.equal(projectSavedWorkReadPresentation(ready).resourcesWritable,true);
 for(const flags of [{resourcesFailed:true},{pending:true},{fetching:true}])assert.equal(projectSavedWorkReadPresentation({...ready,...flags}).resourcesWritable,false);
 assert.equal(projectSavedWorkReadPresentation({...ready,resourcesFailed:true}).retryAvailable,true);
 assert.equal(projectSavedWorkReadPresentation({...ready,resourcesFailed:true,fetching:true}).retryAvailable,false);
});
