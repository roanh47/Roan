// JNI bridge into libnode. Android cannot spawn a process that is not in the
// apk, so the daemon runs inside the app: this starts the Node runtime on a
// worker thread and points its stdio at a log file, because a phone has no
// terminal to print to.

#include <jni.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <unistd.h>
#include <vector>

#include "node.h"

namespace {

std::string fromJava(JNIEnv* env, jstring value) {
  const char* chars = env->GetStringUTFChars(value, nullptr);
  std::string text(chars == nullptr ? "" : chars);
  if (chars != nullptr) env->ReleaseStringUTFChars(value, chars);
  return text;
}

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_dev_roan_RoanNode_setEnvironment(JNIEnv* env, jobject /* this */, jstring name, jstring value) {
  const std::string key = fromJava(env, name);
  const std::string text = fromJava(env, value);
  setenv(key.c_str(), text.c_str(), 1);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_roan_RoanNode_startNodeWithArguments(JNIEnv* env, jobject /* this */, jobjectArray arguments) {
  // Everything the daemon writes goes to a file: stderr from a WebView host is
  // dropped, and a silent daemon is impossible to debug on a phone.
  const char* logPath = getenv("ROAN_LOG_PATH");
  if (logPath != nullptr && *logPath != '\0') {
    if (FILE* log = freopen(logPath, "a", stdout)) {
      dup2(fileno(log), fileno(stderr));
    }
  }

  const jsize count = env->GetArrayLength(arguments);
  std::vector<std::string> storage;
  storage.reserve(static_cast<size_t>(count));
  for (jsize index = 0; index < count; index += 1) {
    jstring item = static_cast<jstring>(env->GetObjectArrayElement(arguments, index));
    storage.push_back(fromJava(env, item));
    env->DeleteLocalRef(item);
  }

  std::vector<char*> argv;
  argv.reserve(storage.size() + 1);
  for (std::string& item : storage) {
    argv.push_back(const_cast<char*>(item.c_str()));
  }
  argv.push_back(nullptr);

  return node::Start(static_cast<int>(storage.size()), argv.data());
}
