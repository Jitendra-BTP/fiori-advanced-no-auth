using { sap.fe.cap.travel as my } from '../db/schema';

service TravelService @(path:'/processor') { 
  //@(restrict: [{ grant: 'READ', to: 'authenticated-user'}, { grant: ['rejectTravel','acceptTravel','deductDiscount'], to: 'reviewer'}, { grant: ['*'], to: 'processor'}, { grant: ['*'], to: 'admin'}])

  entity SupplementScope as projection on my.SupplementScope;

  function getBookingDataOfPassenger(CustomerID: String) returns my.BookingData;

  entity Travel as projection on my.Travel { *,
    TravelID: String @readonly @Common.Text: Description,
    to_Customer.FirstName || ' ' || to_Customer.LastName as CustomerFullName : String,
    @Common.Text: CustomerFullName
    to_Customer,
    to_Agency.Name                                       as AgencyName,
    @Common.Text: AgencyName
    to_Agency,
    to_Customer.CountryCode.name as PassengerCountryName,
    @Common.Text: PassengerCountryName
    to_Customer.CountryCode.code                         as PassengerCountry,
    TravelStatus.name as TravelStatusName,
    @Common.Text: TravelStatusName
    TravelStatus
  } actions { action createTravelByTemplate() returns Travel; action rejectTravel(); action acceptTravel(); action deductDiscount(@(UI.ParameterDefaultValue : 5)percent: Percentage not null @mandatory ) returns Travel; };

  entity Passenger as projection on my.Passenger { *,
    FirstName || ' ' || LastName as FullName: String @title : '{i18n>fullName}',
    to_Booking: Association to many my.Booking on to_Booking.to_Customer = $self
  }

  annotate my.Booking {
    to_Customer @Common.Text: to_Customer.FullName
  }  
  annotate Passenger {
    CustomerID @Common.Text: FullName;
  }

  annotate my.MasterData with @cds.autoexpose @readonly;
}

annotate TravelService.Travel with @odata.draft.enabled;

type Percentage : Integer @assert.range: [1,100];

annotate TravelService.Travel with @Aggregation.ApplySupported: { Transformations       : [ 'aggregate', 'topcount', 'bottomcount', 'identity', 'concat', 'groupby', 'filter', 'search' ],
                                                                  Rollup                : #None,
                                                                  PropertyRestrictions  : true,
                                                                  GroupableProperties   : [ to_Customer_CustomerID, to_Agency_AgencyID, TravelStatus_code, BeginDate, PassengerCountry, ],
                                                                  AggregatableProperties: [ {Property: TravelID, } ],
};