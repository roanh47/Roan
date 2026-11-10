import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildManifest, type ManifestSpec } from "./manifest.js";

function validSpec(): ManifestSpec {
  return {
    packageName: "nl.roan.share",
    versionName: "1.2.3",
    versionCode: 7,
    minSdk: 26,
    targetSdk: 34,
    permissions: ["android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS"],
    shareActivity: {
      name: ".ShareActivity",
      label: `Roan & "Co" <deel> 'x'`,
      mimeTypes: ["text/plain", "image/*"],
    },
    syncService: {
      name: ".SyncService",
      exported: false,
    },
  };
}

describe("buildManifest", () => {
  it("renders a full manifest with escaped attribute values", () => {
    const xml = buildManifest(validSpec());

    const expected = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="nl.roan.share"
    android:versionCode="7"
    android:versionName="1.2.3">

    <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application>
        <activity android:name=".ShareActivity" android:label="Roan &amp; &quot;Co&quot; &lt;deel&gt; &#39;x&#39;" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="image/*" />
            </intent-filter>
        </activity>
        <service android:name=".SyncService" android:exported="false" />
    </application>
</manifest>
`;

    assert.equal(xml, expected);
    assert.equal(xml.includes(`Roan & "Co"`), false);
  });

  it("is deterministic across calls", () => {
    assert.equal(buildManifest(validSpec()), buildManifest(validSpec()));
  });

  it("accepts names written with the full package prefix", () => {
    const spec = validSpec();
    spec.shareActivity.name = "nl.roan.share.ShareActivity";
    spec.syncService = { name: "nl.roan.share.SyncService", exported: true };

    const xml = buildManifest(spec);

    assert.equal(xml.includes(`android:name="nl.roan.share.ShareActivity"`), true);
    assert.equal(xml.includes(`<service android:name="nl.roan.share.SyncService" android:exported="true" />`), true);
  });

  it("emits one uses-permission per distinct permission, in input order", () => {
    const spec = validSpec();
    spec.permissions = ["b.P", "a.P", "b.P"];

    const xml = buildManifest(spec);
    const names = xml
      .split("\n")
      .filter((line) => line.includes("<uses-permission "))
      .map((line) => line.trim());

    assert.deepEqual(names, [
      `<uses-permission android:name="b.P" />`,
      `<uses-permission android:name="a.P" />`,
    ]);
  });

  describe("validation", () => {
    it("rejects a package name with uppercase letters", () => {
      const spec = validSpec();
      spec.packageName = "Nl.Roan.Share";

      assert.throws(
        () => buildManifest(spec),
        (error: unknown) => {
          assert.equal(error instanceof Error, true);
          const message = (error as Error).message;
          assert.equal(message.includes("packageName"), true);
          assert.equal(message.includes("Nl.Roan.Share"), true);
          return true;
        },
      );
    });

    it("rejects a single-segment package name", () => {
      const spec = validSpec();
      spec.packageName = "roan";

      assert.throws(() => buildManifest(spec), /packageName.*"roan"/);
    });

    it("rejects a versionCode of zero", () => {
      const spec = validSpec();
      spec.versionCode = 0;

      assert.throws(() => buildManifest(spec), /versionCode.*"0"/);
    });

    it("rejects a non-integer versionCode", () => {
      const spec = validSpec();
      spec.versionCode = 1.5;

      assert.throws(() => buildManifest(spec), /versionCode.*"1\.5"/);
    });

    it("rejects minSdk above targetSdk", () => {
      const spec = validSpec();
      spec.minSdk = 35;
      spec.targetSdk = 34;

      assert.throws(() => buildManifest(spec), (error: unknown) => {
        const message = (error as Error).message;
        assert.equal(message.includes("minSdk"), true);
        assert.equal(message.includes("35"), true);
        assert.equal(message.includes("targetSdk"), true);
        return true;
      });
    });

    it("rejects an empty mime type list", () => {
      const spec = validSpec();
      spec.shareActivity.mimeTypes = [];

      assert.throws(() => buildManifest(spec), /mimeTypes/);
    });

    it("rejects an activity name that is neither relative nor package-prefixed", () => {
      const spec = validSpec();
      spec.shareActivity.name = "ShareActivity";

      assert.throws(() => buildManifest(spec), /shareActivity\.name.*"ShareActivity"/);
    });

    it("rejects a service name from another package", () => {
      const spec = validSpec();
      spec.syncService.name = "nl.other.SyncService";

      assert.throws(() => buildManifest(spec), /syncService\.name.*"nl\.other\.SyncService"/);
    });
  });
});
