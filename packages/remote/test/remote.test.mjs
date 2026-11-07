import test from "node:test";
import assert from "node:assert/strict";
import { validateRemoteAlias, validateRemoteDestination, validateRemoteWorkspace, RemoteTransportError } from "../dist/index.js";

test("validates simple remote names and SSH destinations", () => {
  assert.equal(validateRemoteAlias("production"), "production");
  assert.equal(validateRemoteDestination("deploy@example.com"), "deploy@example.com");
  assert.equal(validateRemoteDestination("my-vps"), "my-vps");
});

test("rejects shell fragments, flags and invalid remote aliases", () => {
  assert.throws(() => validateRemoteAlias("../prod"), RemoteTransportError);
  assert.throws(() => validateRemoteDestination("-oProxyCommand=bad"), RemoteTransportError);
  assert.throws(() => validateRemoteDestination("user@host; touch file"), RemoteTransportError);
  assert.throws(() => validateRemoteDestination("host:22"), RemoteTransportError);
});

test("validates explicit remote workspace scopes", () => {
  assert.equal(validateRemoteWorkspace("."), ".");
  assert.equal(validateRemoteWorkspace("/home/deploy/site"), "/home/deploy/site");
  assert.throws(() => validateRemoteWorkspace("/"), RemoteTransportError);
  assert.throws(() => validateRemoteWorkspace("/home/deploy/../root"), RemoteTransportError);
  assert.throws(() => validateRemoteWorkspace("~/.config"), RemoteTransportError);
});
