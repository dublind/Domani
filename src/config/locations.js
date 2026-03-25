/**
 * Lee todas las ubicaciones configuradas en el .env
 * Formato: LOC1_NAME, LOC1_TOTEAT_TOKEN, LOC1_TOTEAT_RESTAURANT_ID, etc.
 * Para agregar un restaurante nuevo, agregar LOC3_*, LOC4_*, etc.
 */
function getLocations() {
  const locations = [];
  let i = 1;

  while (true) {
    const name = process.env[`LOC${i}_NAME`];
    if (!name) break; // No hay más restaurantes configurados

    const buyerGuid = process.env[`LOC${i}_MARKETMAN_BUYER_GUID`];

    locations.push({
      name,
      toteat: {
        token: process.env[`LOC${i}_TOTEAT_TOKEN`],
        restaurantId: process.env[`LOC${i}_TOTEAT_RESTAURANT_ID`],
        localId: process.env[`LOC${i}_TOTEAT_LOCAL_ID`] || '1',
        userId: process.env[`LOC${i}_TOTEAT_USER_ID`] || '1001',
        baseUrl: 'https://api.toteat.com/mw/or/1.0'
      },
      marketman: {
        buyerGuid: buyerGuid && buyerGuid !== 'pendiente' ? buyerGuid : null
      }
    });

    i++;
  }

  return locations;
}

module.exports = { getLocations };
