{
  "targets": [{
    "target_name": "lios_native_runtime_fs",
    "sources": ["windows.cc"],
    "defines": ["NAPI_VERSION=8", "UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN", "NOMINMAX"],
    "conditions": [["OS=='win'", {"libraries": ["advapi32.lib"]}]],
    "msvs_settings": {"VCCLCompilerTool": {"ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17", "/W4"]}}
  }]
}
