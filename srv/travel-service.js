const cds = require ('@sap/cds'); 

//require('./workarounds')

class TravelService extends cds.ApplicationService {
init() {

  const { Travel, Booking, BookingSupplement } = this.entities

  this.before ('CREATE', 'Travel', async req => {
    const { maxID } = await SELECT.one `max(TravelID) as maxID` .from (Travel)
    req.data.TravelID = maxID + 1
  })

  this.before ('CREATE', 'Booking.drafts', async (req) => {
    const { to_Travel_TravelUUID } = req.data
    const { status } = await SELECT `TravelStatus_code as status` .from (Travel.drafts, to_Travel_TravelUUID)
    if (status === 'X') throw req.reject (400, 'Cannot add new bookings to rejected travels.')
    const { maxID } = await SELECT.one `max(BookingID) as maxID` .from (Booking.drafts) .where ({to_Travel_TravelUUID})
    req.data.BookingID = maxID + 1
    req.data.BookingStatus_code = 'N'
    req.data.BookingDate = (new Date).toISOString().slice(0,10) // today
  })

  this.before ('CREATE', 'BookingSupplement.drafts', async (req) => {
    const { to_Booking_BookingUUID } = req.data
    const { maxID } = await SELECT.one `max(BookingSupplementID) as maxID` .from (BookingSupplement.drafts) .where ({to_Booking_BookingUUID})
    req.data.BookingSupplementID = maxID + 1
  })

  this.before ('UPDATE', 'Travel.drafts', async (req) => { if ('BookingFee' in req.data) {
    const { status } = await SELECT.one `TravelStatus_code as status` .from (req.subject)
    if (status === 'A') req.reject(400, 'Booking fee can not be updated for accepted travels.', 'BookingFee')
  }})

  this.after ('UPDATE', 'Travel.drafts', (_,req) => { if ('BookingFee' in req.data) {
    return this._update_totals4 (req.data.TravelUUID)
  }})

  this.after ('UPDATE', 'Booking.drafts', async (_,req) => { if ('FlightPrice' in req.data) {
    // We need to fetch the Travel's UUID for the given Booking target
    const { travel } = await SELECT.one `to_Travel_TravelUUID as travel` .from (req.subject)
    return this._update_totals4 (travel)
  }})

  this.after ('UPDATE', 'BookingSupplement.drafts', async (_,req) => { if ('Price' in req.data) {
    // We need to fetch the Travel's UUID for the given Supplement target
    const { booking } = await SELECT.one `to_Booking_BookingUUID as booking`
      .from (BookingSupplement.drafts).where({BookSupplUUID:req.data.BookSupplUUID})
    const { travel } = await SELECT.one `to_Travel_TravelUUID as travel` .from (Booking.drafts)
      .where `BookingUUID = ${booking} `
    return this._update_totals4 (travel)
  }})

  // this.on('DELETE', BookingSupplement.drafts, async (req, next) => {
  //   // Find out which travel is affected before the delete
  //   const { BookSupplUUID } = req.data
  //   const { to_Travel_TravelUUID } = await SELECT.one
  //     .from(BookingSupplement.drafts, ['to_Travel_TravelUUID'])
  //     .where({ BookSupplUUID })
  //   // Delete handled by generic handlers
  //   const res = await next()
  //   // After the delete, update the totals
  //   await this._update_totals4(to_Travel_TravelUUID)
  //   return res
  // })
  
  // this.on('DELETE', Booking.drafts, async (req, next) => {
  //   // Find out which travel is affected before the delete
  //   const { BookingUUID } = req.data
  //   const { to_Travel_TravelUUID } = await SELECT.one
  //     .from(Booking.drafts, ['to_Travel_TravelUUID'])
  //     .where({ BookingUUID })
  //   // Delete handled by generic handlers
  //   const res = await next()
  //   // After the delete, update the totals
  //   await this._update_totals4(to_Travel_TravelUUID)
  //   return res
  // })

  this._update_totals4 = function (travel) {
    return UPDATE (Travel.drafts, travel) .alias('T') .with ({ TotalPrice: CXL `coalesce (T.BookingFee, 0) + ${
      SELECT `coalesce (sum (B.FlightPrice + ${
        SELECT `coalesce (sum (BS.Price),0)` .from (BookingSupplement.drafts) .alias('BS') .where `BS.to_Booking_BookingUUID = B.BookingUUID`
      }),0)` .from (Booking.drafts) .alias('B') .where `B.to_Travel_TravelUUID = T.TravelUUID`
    }` })
  }

  this.before ('SAVE', 'Travel', req => {
    const { BeginDate, EndDate } = req.data, today = (new Date).toISOString().slice(0,10)
    if (BeginDate < today) req.error (400, `Begin Date ${BeginDate} must not be before today ${today}.`, 'in/BeginDate')
    if (BeginDate > EndDate) req.error (400, `Begin Date ${BeginDate} must be before End Date ${EndDate}.`, 'in/BeginDate')
  })

  this.on ('acceptTravel', req => UPDATE (req.subject) .with ({TravelStatus_code:'A'}))
  this.on ('rejectTravel', req => UPDATE (req.subject) .with ({TravelStatus_code:'X'}))

  this.on ('deductDiscount', async req => {
    let discount = req.data.percent / 100
    let succeeded = await UPDATE (req.subject)
      .where `TravelStatus_code != 'A'`
      .and `BookingFee is not null`
      .with (`
        TotalPrice = round (TotalPrice - BookingFee * ${discount}, 3),
        BookingFee = round (BookingFee - BookingFee * ${discount}, 3)
      `)
    if (!succeeded) { //> let's find out why...
      let travel = await SELECT.one `TravelID as ID, TravelStatus_code as status, BookingFee` .from (req.subject)
      if (!travel) throw req.reject (404, `Travel "${travel.ID}" does not exist; may have been deleted meanwhile.`)
      if (travel.status === 'A') req.reject (400, `Travel "${travel.ID}" has been approved already.`)
      if (travel.BookingFee == null) throw req.reject (404, `No discount possible, as travel "${travel.ID}" does not yet have a booking fee added.`)
    } else {
      return this.read(req.subject)
    }
  })

  return super.init()

}}
module.exports = {TravelService}
