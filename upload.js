const fs = require('fs');
const path = require('path');
const { create } = require('ipfs-http-client');

const cliProgress = require('cli-progress');
const colors = require('ansi-colors');

// read command arguments
const IPFS_URL = process.argv[2];
const COLLECTION_NAME = process.argv[3]; // should be unique in ipfs

const ipfs = create({ url: IPFS_URL });

function createProcessBar(barname, total) {
  const pbar = new cliProgress.SingleBar(
    {
      format: `${colors.cyan(`${barname}`)} | ${colors.cyan('{bar}')} | {percentage}% || {value}/{total} Chunks`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );
  pbar.start(total, 0);
  return pbar;
}

async function makeIPFSDir(dirName) {
  return ipfs.files.mkdir(`/${dirName}`).catch((error) => {
    if (error.toString() === 'HTTPError: file already exists') throw new Error(`Folder ${dirName} already exists in IPFS`);
  });
}

async function uploadFileToIPFSFolder(localDirPath, filename, ipfsDirName) {
  const filedata = fs.readFileSync(`${localDirPath}/${filename}`);
  await ipfs.files.write(`/${ipfsDirName}/${filename}`, filedata, { create: true });
}

// WSL path to Window folder: e.g. /mnt/c/Users/.../Downloads/export_11/images
async function uploadFolder(localDirPath, ipfsDirName) {
  const filenames = fs.readdirSync(localDirPath);
  filenames.sort();
  const numberOfFile = filenames.length;

  console.log(`\nNumber of file:\t\t${numberOfFile}`);
  console.log(`First filename:\t\t${filenames[0]}`);

  const jump = 100;
  // create pbar
  const pbar = createProcessBar('upload files', numberOfFile > jump ? numberOfFile / jump : 1);
  for (let i = 0; i < numberOfFile; i += jump) {
    const uploadPromisses = filenames
      .slice(i, i + jump)
      .map((filename) =>
        uploadFileToIPFSFolder(localDirPath, filename, ipfsDirName));
    await Promise.all(uploadPromisses);
    pbar.increment();
  }

  const uploadResponse = await ipfs.files.stat(`/${ipfsDirName}`);
  uploadResponse.cid = uploadResponse.cid.toString();
  // verify that all files are uploaded
  if (uploadResponse.blocks !== numberOfFile) {
    console.log(`\nUpload response: ${JSON.stringify(uploadResponse, null, 2)}`);
    throw new Error(`Not all file uploaded. Only ${uploadResponse.blocks}/${numberOfFile} files uploaded`);
  }

  console.log(`\nSuccessfully uploaded to ${ipfsDirName} (cid: "${uploadResponse.cid}")\n`);
  return { folder_cid: uploadResponse.cid, uploaded_file_names: filenames };
}

async function replaceImageURI(uploadImagesResponse, metadataDir) {
  console.log('Update metadata URI!');
  const imageFilenames = uploadImagesResponse.uploaded_file_names;
  imageFilenames.sort();

  const metadataFilenames = fs.readdirSync(metadataDir);
  if (imageFilenames.length !== metadataFilenames.length) {
    throw new Error(
      `Number of image (${imageFilenames.length}) is not equal to number of metadata files (${metadataFilenames.length})`,
    );
  }
  metadataFilenames.sort();

  for (let i = 0; i < imageFilenames.length; i += 1) {
    const imageFilename = imageFilenames[i];
    const metadataFilePath = `${metadataDir}/${metadataFilenames[i]}`;
    const metadata = JSON.parse(fs.readFileSync(metadataFilePath));
    metadata.image = `ipfs://${uploadImagesResponse.folder_cid}/${imageFilename}`; // update image URI
    fs.writeFileSync(metadataFilePath, JSON.stringify(metadata));
  }
  console.log('Updated Succeeded!\n');
}

async function parseMetadata() {
  try { 
    fs.mkdirSync('metadata'); 
  } catch (error) { 
    if(error.toString().startsWith('Error: EEXIST: file already exists')) {
      const data = fs.readdirSync('metadata');
      console.log(data);
      for(const file of data) {
        fs.unlinkSync(path.join('metadata', file));
      }
    } 
  }

  const data = fs.readFileSync('metadata.csv', 'utf-8');
  const rows = data.split("\n");
  const headers = rows[0].split(",");
  const attributes = headers.slice(3);

  for(let i = 1; i < rows.length; i++) {
    const atts = rows[i].split(",");
    const jsonData = {
      name: atts[0],
      description: atts[1],
      image: atts[2],
      attributes: atts.slice(3).map((value, index) => ({
        trait_type: attributes[index], value}))
    };
    fs.writeFileSync(`metadata/${i}.json`, JSON.stringify(jsonData));
  }
}

async function exportImages() {
  // upload image to IPFS
  await makeIPFSDir(`/${COLLECTION_NAME}`);
  const imageIPFSDirName = `/${COLLECTION_NAME}/images`;
  await makeIPFSDir(imageIPFSDirName);
  const metadataIPFSDirName = `/${COLLECTION_NAME}/metadata`
  await makeIPFSDir(metadataIPFSDirName);

  let uploadImagesResponse = await uploadFolder('./images', imageIPFSDirName);
  await replaceImageURI(uploadImagesResponse, './metadata');
  let uploadMetadataResponse = await uploadFolder('./metadata', metadataIPFSDirName);

  console.log(uploadMetadataResponse);
}

parseMetadata().then(() => exportImages());
