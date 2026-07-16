M561 ; clear any bed transform


var dock0 = sensors.gpIn[10].value
var dock1 = sensors.gpIn[11].value
var dock2 = sensors.gpIn[12].value
var dock3 = sensors.gpIn[13].value
var undockedTools = ""
var cancelMessage = "Cancelling, one or more tools undocked: "
if { var.dock0 == 0 }
    set var.undockedTools = var.undockedTools ^ "0"
    set var.cancelMessage = var.cancelMessage ^ "0"
if { var.dock1 == 0 }
    set var.undockedTools = var.undockedTools ^ "1"
    if #var.undockedTools >= 1
        set var.cancelMessage = var.cancelMessage ^ ", "     
    set var.cancelMessage = var.cancelMessage ^ "1"
if { var.dock2 == 0 }
    if #var.undockedTools >= 1
        set var.cancelMessage = var.cancelMessage ^ ", "     
    set var.undockedTools = var.undockedTools ^ "2"
    set var.cancelMessage = var.cancelMessage ^ "2"
if { var.dock3 == 0 }
    if #var.undockedTools >= 1
        set var.cancelMessage = var.cancelMessage ^ ", "     
    set var.undockedTools = var.undockedTools ^ "3"
    set var.cancelMessage = var.cancelMessage ^ "3"


set var.undockedTools = ""
if #var.undockedTools > 0    
    M291 P{var.cancelMessage} 
else
    G29 S0
    G28 Z