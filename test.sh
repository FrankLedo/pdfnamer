#!/bin/sh
newFile = $(./src/index.js "${1}")
echo "${1} => ${newFile}" >> ~/testoutput.txt
echo $1
