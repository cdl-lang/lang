// this micro mongo-db script removes the cdlpersistence database,
// so that it would be recreated the next time the server starts.
// it is highly recommended to stop the server before running this
db = db.getSiblingDB("cdlpersistence");
db.dropDatabase();
