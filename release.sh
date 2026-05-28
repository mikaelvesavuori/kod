#!/bin/bash

# Setup variables
VERSION="${npm_package_version:-$(npm pkg get version | tr -d '"')}"
TEMP_RELEASE_FOLDER="kod"

# Remove old stuff
rm -rf $TEMP_RELEASE_FOLDER

# Build the code
npm run build

# Create temporary release folder
mkdir -p $TEMP_RELEASE_FOLDER

# Copy build artifacts
cp -r dist/* $TEMP_RELEASE_FOLDER/

# Create VERSION file
echo "$VERSION" > $TEMP_RELEASE_FOLDER/VERSION

# Copy LICENSE
cp LICENSE $TEMP_RELEASE_FOLDER/

# Copy README
cp README.md $TEMP_RELEASE_FOLDER/README.md

# Create SBOM
npm run sbom
cp sbom.json $TEMP_RELEASE_FOLDER/sbom.json

# Create OSS license list
npm run docs:licenses
mv oss-licenses.txt $TEMP_RELEASE_FOLDER/oss-licenses.txt

# Create zip archives
zip -r "kod_${VERSION}.zip" $TEMP_RELEASE_FOLDER
zip -r "kod_latest.zip" $TEMP_RELEASE_FOLDER
