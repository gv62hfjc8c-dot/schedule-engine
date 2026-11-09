import {
  crossTabCommitKey,isOtherTabStateCommit,notifyOtherTabsOfStateCommit,
} from "./utils/crossTabStateSignal";

function assert(value:unknown,message:string):asserts value{
  if(!value)throw Error("PR47-16: "+message);
}

const ownerA="11111111-1111-4111-8111-111111111111";
const ownerB="22222222-2222-4222-8222-222222222222";
const event1="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const event2="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const commits=new Map<string,string>();
const storage={
  setItem(key:string,value:string){commits.set(key,value);},
};

notifyOtherTabsOfStateCommit(storage,ownerA,event1);
assert(commits.size===1,"A successful save emits one event for its owner.");
assert(isOtherTabStateCommit(crossTabCommitKey(ownerA),event1,ownerA),
  "A stale tab for the same signed-in owner sees the event.");
assert(!isOtherTabStateCommit(crossTabCommitKey(ownerA),event1,ownerB),
  "A different account cannot be blocked by another owner's saves.");
assert(!isOtherTabStateCommit(crossTabCommitKey(ownerB),event1,ownerA),
  "Wrong storage key is not accepted.");
assert(!isOtherTabStateCommit(crossTabCommitKey(ownerA),null,ownerA),
  "Removing an old key is not a new server write.");
assert(!isOtherTabStateCommit(crossTabCommitKey(ownerA),"tampered",ownerA),
  "Malformed event metadata must not look like a confirmed save.");

notifyOtherTabsOfStateCommit(storage,ownerA,event2);
assert(commits.get(crossTabCommitKey(ownerA))===event2,
  "Repeated saves signal distinct commits on the same key.");
assert(isOtherTabStateCommit(crossTabCommitKey(ownerA),event2,ownerA),
  "A second save is observable to the other tab.");

let invalid=false;
try {notifyOtherTabsOfStateCommit(storage,ownerA,"not-uuid");}
catch {invalid=true;}
assert(invalid,"Never signal malformed commit metadata.");
invalid=false;
try{crossTabCommitKey("not-owner");}
catch {invalid=true;}
assert(invalid,"Never construct cross-account signals with malformed identities.");

const failingStorage={setItem(){throw Error("Browser storage disabled");}};
let threw=false;
try{notifyOtherTabsOfStateCommit(failingStorage,ownerA,event1);}
catch{threw=true;}
assert(threw,"Storage-disabled simulation must be observable to the caller.");
console.log("PR47-16: same-account notifications, isolation, repeated commits and storage failure passed.");
