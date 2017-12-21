// this micro mongo-db script prints the cdlpersistence database.
// the script iterates the applications, and for each application iterates
//  the records. The area-ids are in the server's per-application namespace,
//  and have little meaning; no effort is made (yet) to display area-ids in
//  a more meaningful way
db = db.getSiblingDB("cdlpersistence");

var collectionArray = db.getCollectionNames();

for (var i = 0; i < collectionArray.length; i++) {
    var collectionName = collectionArray[i];

    if (! collectionName.match(/rrm.appState/)) {
        continue;
    }

    if (collectionName.match(/rrm.appState.index/)) {
        continue;
    }
    if (collectionName.match(/rrm.appState.template/)) {
        continue;
    }

    print("Collection: " + collectionName);
    print("----------------------------------------------------");
    cursor = db[collectionName].find();
    while (cursor.hasNext()) {
        print("<<<");
        printjson(cursor.next());
        print(">>>");
    }
    print("");
    print("");
    print("");
}
