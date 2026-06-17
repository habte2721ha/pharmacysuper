import PocketBase from 'pocketbase';
console.log(Object.keys(new PocketBase('http://localhost').collections));
