import PocketBase from 'pocketbase';

async function test() {
    const pb = new PocketBase('https://sonanpharm.pockethost.io/');
    try {
        console.log("Authenticating...");
        await pb.collection('_superusers').authWithPassword('sonanpharmacy@gmail.com', 'Passw0rd123!');
        console.log("Success authentication!");
        
        const cols = await pb.collections.getFullList();
        console.log("Collections:", cols.map((c: any) => c.name));
    } catch(e: any) {
        console.error(e.message, e.data);
    }
}
test();
