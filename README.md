CDL
===

## Introduction

CDL is a mature functional programming language for web-based applications.

## Dependencies

In order to compile CDL programs, you need to have the following installed on your computer:

* node.js (version v8.9.1 or higher)
* make (GNU Make version 4.2.1 or higher)

Further, you would need the following npm packages (npm is part of the node.js installation):

* typescript@2.9.2
* uglify-js@2.8.29

After installing node.js, run the following to install these packages:

      npm install typescript
      npm install uglify-js

### Dependency Notes

* uglify-js is only needed when you want to build a minified/uglified version of the runtime.

* The Makefile assumes `tsc` and `uglifyjs` are the commands to invoke the Typescript compiler and uglify and that they are installed globally. If your system is organized differently, please change the definitions of the makefile variables `TSC` in `scripts/feg/Makefile` and `scripts/remoting/Makefile`, and/or `UGLIFY` in `util/mmk`.

* Building a persistence server or running tests downloads node modules via npm. Note that the persistence server depends on websockets, which in turn requires a C compiler to build.

## Getting Started

### Directories and Makefiles

Having installed the above, place a copy of this respository anywhere on your computer (for example, under `/opt/cdl-lang`). A CDL application can now be compiled in any directory by putting the following `Makefile` in the directory.

```
LANGDIR=/opt/cdl-lang
CDLPATH=.
include $(LANGDIR)/util/mmk
```

`LANGDIR` should point at the directory where this repository was placed (`/opt/cdl-lang` in our example). `CDLPATH` should point at all directories where CDL code used by your CDL program is found. Initially, this may only be the local directory, but if your code uses external CDL classes, the directory where these classes are defined should also be added to the list of directories under `CDLPATH`. For example, if you have CDL classes defined in directory `/home/<user>/cdl-classes` you should add this directory to `CDLPATH`, as follows:

    CDLPATH=.;/home/<user>/cdl-classes

### Hello, World

CDL code is written in files with a `.cdl` suffix.

A CDL application must contain a screen area. The following CDL program displays the string "Hello, world": 

```
var screenArea = {
    display: {
        text: { value: "Hello, world" }
    }
}
```

Assuming this code is in a file `helloWorld.cdl`, place a Makefile (as described above) in the same directory and then run (in that directory):

    make helloWorld.html

This will generate the HTML file `helloWorld.html`. Load this file into your browser to run the application.

To use classes, it is recommended to define these classes in separate files and include these files in the main application file. A class file, whose name should also end with a `.cdl` suffix, can be placed in any of the directories appearing in the `CDLPATH` your makefile defines. For example, create a class file `helloWorldClasses.cdl` containing the following class definitions:

```
var classes = {
    HelloWorldStyle: {
        display: {
            background: "lightblue",
            text: {
                fontSize: 48
            }
        }
    }
}
```

You can then use this file in your hello world application by including this file and referring to the `HelloWorldStyle` class defined in it:

```
// %%classfile%%: "helloWorldClasses.cdl"
var screenArea = {
    class: HelloWorldStyle,
    display: {
        text: { value: "Hello World" }
    }
}
```

## Third Party Source Code

For printing and saving to SVG the following libraries are used

* dom-to-image: converts HTML to png or svg;
  version: 2.6.0;
  source: https://github.com/tsayen/dom-to-image;
  license: MIT

* FileSaver: a file-save-as function that is compatible with many browsers;
  version: 1.3.3;
  source: https://github.com/eligrey/FileSaver.js;
  license: MIT

## License

[Apache 2.0](https://choosealicense.com/licenses/apache-2.0/)
