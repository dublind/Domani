// Updated implementation of marketman.service.js

// Function to upload data using MarketMan APIs
const uploadData = (data) => {
    const startDate = data.startDate;
    const fromDateUTC = startDate;
    const toDateUTC = startDate;

    // Call the MarketMan API with fromDateUTC and toDateUTC
    MarketManAPI.upload({
        fromDateUTC,
        toDateUTC,
        ...data
    });
};

export { uploadData };