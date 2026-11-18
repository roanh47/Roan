cmake_minimum_required(VERSION 3.22)
project(roan_node CXX)

# node.h uses concepts, so the bridge has to be built as C++20.
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The Node runtime ships as a prebuilt shared library per ABI (libnode.so, from
# the nodejs-mobile recipe). Gradle packages the copies in jniLibs; this target
# links against the one for the ABI being built.
set(LIBNODE_SO ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so)
if(NOT EXISTS ${LIBNODE_SO})
  # There is no libnode for every ABI gradle may configure (x86 has none at
  # all). Skipping here means that ABI simply has no bridge; the ABIs that are
  # packaged are the ones the build was wired for.
  message(WARNING "no libnode.so for ${ANDROID_ABI} — skipping the daemon bridge for this ABI")
  return()
endif()

add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION ${LIBNODE_SO})

include_directories(${CMAKE_CURRENT_SOURCE_DIR}/libnode/include/node)

add_library(roan_node SHARED start-node.cpp)

find_library(log-lib log)
target_link_libraries(roan_node libnode ${log-lib})
