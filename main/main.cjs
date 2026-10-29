import("./app.mjs").catch((error) => {
  console.error(error.message);
  process.exit(1);
});
