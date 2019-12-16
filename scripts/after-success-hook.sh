#!/bin/bash
set -ev

# if master branch & not pull-request
if [ "${TRAVIS_PULL_REQUEST}" = "false" ] && [ "${TRAVIS_BRANCH}" = "master" ]; then
    ARCHIVE_DIR="vivliostyle"
    ARCHIVE_PATH="vivliostyle.zip"
    VIEWER_ARTIFACTS=packages/viewer/lib/*

    # git
    git config user.email "murakami@vivliostyle.org"
    git config user.name "MurakamiShinyu (CI)"

    # generate archive
    scripts/generate-viewer-archive.sh "${ARCHIVE_DIR}" "${ARCHIVE_PATH}"

    # fetch vivliostyle.github.io
    git clone --depth=1 --branch=master git@github.com:vivliostyle/vivliostyle.github.io.git vivliostyle.github.io

    # copy canary viewer to vivliostyle.github.io
    CANARY_VIEWER_ROOT="vivliostyle.github.io/viewer"
    mkdir -p "${CANARY_VIEWER_ROOT}"
    cp -R ${VIEWER_ARTIFACTS} "${CANARY_VIEWER_ROOT}/"
    cp -R "${ARCHIVE_PATH}" "${CANARY_VIEWER_ROOT}/vivliostyle-canary.zip"

    # if stable release (v2.0.0, v3.10.100, ...)
    if [ "${TRAVIS_TAG}" != "" ] && [[ ${TRAVIS_TAG} =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        VERSION=$(echo ${TRAVIS_TAG} | sed 's/^v\(.*\)/\1/')
        TAGGED_VIEWER_ROOT="vivliostyle.github.io/viewer/${TRAVIS_TAG}"

        # copy tagged resources to vivliostyle.github.io
        mkdir -p "${TAGGED_VIEWER_ROOT}"
        cp -R ${VIEWER_ARTIFACTS} "${TAGGED_VIEWER_ROOT}/"
        # cp -R "${ARCHIVE_PATH}" "${TAGGED_VIEWER_ROOT}/vivliostyle-${VERSION}.zip"
        echo "${TRAVIS_TAG},${VERSION}" >> vivliostyle.github.io/_data/releases.csv

        # copy latest resources to vivliostyle.org
        git clone --depth=1 --branch=master git@github.com:vivliostyle/vivliostyle.org.git vivliostyle.org
        mkdir -p "vivliostyle.org/viewer"
        cp -R ${VIEWER_ARTIFACTS} "vivliostyle.org/viewer/"
        cp -R "${ARCHIVE_PATH}" "vivliostyle.org/viewer/vivliostyle-latest.zip"
        mkdir -p "vivliostyle.org/docs/user-guide/"
        cp -R docs/user-guide/* vivliostyle.org/docs/user-guide/
        cp    docs/supported-features.md vivliostyle.org/docs/

        # commit changes to vivliostyle.org
        echo -e "$GITHUB_DEPLOY_KEY_VIVLIOSTYLE_ORG" | base64 -d > ~/.ssh/deploy-vivliostyle-org.key
        chmod 600 ~/.ssh/deploy-vivliostyle-org.key
        echo -e "Host github.com\n\tStrictHostKeyChecking no\nIdentityFile ~/.ssh/deploy-vivliostyle-org.key\n" >> ~/.ssh/config
        cd vivliostyle.org
        git add .
        git status
        git commit -m "Update vivliostyle latest release (original commit: $TRAVIS_COMMIT)"
        git push origin master
        cd ..

        # publish to npm
        echo "//registry.npmjs.org/:_authToken=${NPM_AUTH_TOKEN}" > ~/.npmrc
        yarn ship --yes
    fi

    # commit changes to vivliostyle.github.io
    echo -e "$GITHUB_DEPLOY_KEY_VIVLIOSTYLE_GITHUB_IO" | base64 -d > ~/.ssh/deploy-vivliostyle-github-io.key
    chmod 600 ~/.ssh/deploy-vivliostyle-github-io.key
    echo -e "Host github.com\n\tStrictHostKeyChecking no\nIdentityFile ~/.ssh/deploy-vivliostyle-github-io.key\n" >> ~/.ssh/config
    cd vivliostyle.github.io
    git add .
    git status
    git commit -m "Update vivliostyle (original commit: $TRAVIS_COMMIT)"
    git push origin master
    cd ..

    # cleanup
    rm -rf vivliostyle.github.io vivliostyle.org
    echo -e "Host github.com\n\tStrictHostKeyChecking no\nIdentityFile ~/.ssh/deploy.key\n" >> ~/.ssh/config
fi