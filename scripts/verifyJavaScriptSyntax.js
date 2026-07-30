const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "..");
const sourceDirectories = ["src", "scripts", "tests"];

const listJavaScriptFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
  });

const main = () => {
  const files = sourceDirectories.flatMap((directory) =>
    listJavaScriptFiles(path.join(repositoryRoot, directory))
  );
  for (const file of files) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  }
  console.log(`JavaScript syntax verification passed (${files.length} files)`);
};

if (require.main === module) main();

module.exports = { listJavaScriptFiles };
