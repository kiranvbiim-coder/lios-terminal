#include <node_api.h>
#ifndef _WIN32
#error This custody binding must be built on Windows x64.
#endif
#include <windows.h>
#include <sddl.h>
#include <io.h>
#include <fcntl.h>
#include <string>
#include <vector>
#include <memory>
#include <stdexcept>

namespace {
struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  explicit Handle(HANDLE raw = INVALID_HANDLE_VALUE) : value(raw) {}
  ~Handle() { if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  HANDLE release() { HANDLE raw=value; value=INVALID_HANDLE_VALUE; return raw; }
};
void check(napi_status status) { if(status!=napi_ok)throw std::runtime_error("Invalid native custody argument."); }
napi_value fail(napi_env env,const char* message){napi_throw_error(env,nullptr,message);return nullptr;}
std::wstring pathArg(napi_env env,napi_value arg) {
  size_t length=0;check(napi_get_value_string_utf16(env,arg,nullptr,0,&length));
  if(length<3||length>32760)throw std::runtime_error("A bounded absolute local Windows path is required.");
  std::u16string input(length+1,u'\0');check(napi_get_value_string_utf16(env,arg,input.data(),input.size(),&length));input.resize(length);
  std::wstring path(input.begin(),input.end());
  if(path.find(L'\0')!=std::wstring::npos||path[1]!=L':'||path[2]!=L'\\'||
      !((path[0]>=L'A'&&path[0]<=L'Z')||(path[0]>=L'a'&&path[0]<=L'z'))||path.find(L'/',0)!=std::wstring::npos)
    throw std::runtime_error("UNC, device, relative or mixed-separator runtime paths are refused.");
  size_t offset=3;
  while(offset<path.size()){
    size_t end=path.find(L'\\',offset);if(end==std::wstring::npos)end=path.size();
    auto part=path.substr(offset,end-offset);
    if(part.empty()||part==L"."||part==L".."||part.back()==L'.'||part.back()==L' '||part.find_first_of(L"<>:\"|?*")!=std::wstring::npos)
      throw std::runtime_error("Unsafe Windows runtime path component.");
    for(wchar_t c:part)if(c<32)throw std::runtime_error("Control character in runtime path.");
    auto stem=part.substr(0,part.find(L'.'));for(auto& c:stem)c=towupper(c);
    if(stem==L"CON"||stem==L"PRN"||stem==L"AUX"||stem==L"NUL"||
       (stem.size()==4&&(stem.substr(0,3)==L"COM"||stem.substr(0,3)==L"LPT")&&stem[3]>=L'1'&&stem[3]<=L'9'))
      throw std::runtime_error("Reserved Windows device path.");
    offset=end+1;
  }
  return path;
}
void inspect(HANDLE handle,bool directory) {
  BY_HANDLE_FILE_INFORMATION info{};
  if(GetFileType(handle)!=FILE_TYPE_DISK||!GetFileInformationByHandle(handle,&info)||
      (info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||
      bool(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=directory||(!directory&&info.nNumberOfLinks!=1))
    throw std::runtime_error("Linked, reparse, special or wrong-kind runtime object refused.");
}
struct DirectoryPin {std::vector<std::unique_ptr<Handle>> handles;};
void closePin(napi_env,void* data,void*){delete static_cast<DirectoryPin*>(data);}
napi_value pinDirectories(napi_env env,napi_callback_info info){
  try{
    size_t argc=1;napi_value args[1];check(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));if(argc!=1)throw std::runtime_error("One directory path required.");
    auto path=pathArg(env,args[0]);auto pin=std::make_unique<DirectoryPin>();
    size_t end=3;
    for(;;){
      auto current=path.substr(0,end);
      auto handle=std::make_unique<Handle>(CreateFileW(current.c_str(),FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
      if(handle->value==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot pin Windows runtime directory ancestry.");
      inspect(handle->value,true);pin->handles.push_back(std::move(handle));
      if(end==path.size())break;
      end=path.find(L'\\',end==3?3:end+1);if(end==std::wstring::npos)end=path.size();
    }
    napi_value external;check(napi_create_external(env,pin.get(),closePin,nullptr,&external));pin.release();return external;
  }catch(const std::exception& error){return fail(env,error.what());}
}
napi_value releasePin(napi_env env,napi_callback_info info){
  size_t argc=1;napi_value args[1];if(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr)!=napi_ok||argc!=1)return fail(env,"One pin required.");
  void* data=nullptr;if(napi_get_value_external(env,args[0],&data)!=napi_ok||!data)return fail(env,"Invalid pin.");
  static_cast<DirectoryPin*>(data)->handles.clear();napi_value result;napi_get_undefined(env,&result);return result;
}
struct PrivateSecurity {
  PSECURITY_DESCRIPTOR descriptor=nullptr;SECURITY_ATTRIBUTES attributes{};
  PrivateSecurity(){
    Handle token;HANDLE raw=nullptr;if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&raw))throw std::runtime_error("Cannot resolve runtime owner.");token.value=raw;
    DWORD size=0;GetTokenInformation(token.value,TokenUser,nullptr,0,&size);std::vector<unsigned char> bytes(size);
    if(!GetTokenInformation(token.value,TokenUser,bytes.data(),size,&size))throw std::runtime_error("Cannot resolve runtime owner identity.");
    LPWSTR sid=nullptr;if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid,&sid))throw std::runtime_error("Cannot encode runtime owner.");
    std::wstring sddl=L"D:P(A;;FA;;;"+std::wstring(sid)+L")(A;;FA;;;SY)(A;;FA;;;BA)";LocalFree(sid);
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,&descriptor,nullptr))throw std::runtime_error("Cannot construct private runtime ACL.");
    attributes={sizeof(SECURITY_ATTRIBUTES),descriptor,FALSE};
  }
  ~PrivateSecurity(){if(descriptor)LocalFree(descriptor);}
};
napi_value openFile(napi_env env,napi_callback_info info){
  try{
    size_t argc=2;napi_value args[2];check(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));if(argc!=2)throw std::runtime_error("Path and creation mode required.");
    auto path=pathArg(env,args[0]);bool create=false;check(napi_get_value_bool(env,args[1],&create));PrivateSecurity security;
    Handle handle(CreateFileW(path.c_str(),create?GENERIC_READ|GENERIC_WRITE:GENERIC_READ,FILE_SHARE_READ,
      create?&security.attributes:nullptr,create?CREATE_NEW:OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
    if(handle.value==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot exclusively open regular runtime file.");
    inspect(handle.value,false);
    int fd=_open_osfhandle(reinterpret_cast<intptr_t>(handle.value),_O_BINARY|(create?_O_RDWR:_O_RDONLY));
    if(fd<0)throw std::runtime_error("Cannot own runtime file descriptor.");handle.release();
    napi_value result;check(napi_create_int32(env,fd,&result));return result;
  }catch(const std::exception& error){return fail(env,error.what());}
}
napi_value makeDirectory(napi_env env,napi_callback_info info){
  try{
    size_t argc=1;napi_value args[1];check(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));if(argc!=1)throw std::runtime_error("One fresh directory required.");
    auto path=pathArg(env,args[0]);PrivateSecurity security;
    if(!CreateDirectoryW(path.c_str(),&security.attributes))throw std::runtime_error("Cannot create private fresh runtime directory.");
    napi_value result;check(napi_get_undefined(env,&result));return result;
  }catch(const std::exception& error){return fail(env,error.what());}
}
}
NAPI_MODULE_INIT(){
  napi_property_descriptor properties[]={
    {"pinDirectories",nullptr,pinDirectories,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"releasePin",nullptr,releasePin,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"openFile",nullptr,openFile,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"makeDirectory",nullptr,makeDirectory,nullptr,nullptr,nullptr,napi_default,nullptr},
  };
  if(napi_define_properties(env,exports,sizeof(properties)/sizeof(properties[0]),properties)!=napi_ok)return nullptr;
  return exports;
}
