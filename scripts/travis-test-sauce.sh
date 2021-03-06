#!/bin/bash

fold_start() {
  echo -e "travis_fold:start:$1\033[33;1m$2\033[0m"
}

fold_end() {
  echo -e "\ntravis_fold:end:$1\r"
}

fold_start test-sauce Sauce
yarn test-sauce
RET=$?
fold_end test-sauce
exit $RET
